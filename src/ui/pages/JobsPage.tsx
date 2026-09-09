import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useNavigate } from "react-router-dom";
import {
  EmptyState,
  ErrorBoundary,
  FilterTabs,
  JobsListSkeleton,
  PageHeader,
  RecentJobCard,
  SearchInput,
  SectionCard,
  StatCard,
} from "../components/v2";
import { useI18n } from "../i18n";
import type { V2Job } from "./v2Types";

// V2.5.1: a reviewable production is a delivered video, so it gets its own tab
// rather than sitting under "Needs Attention" beside real failures.
const GROUPS = ["all", "active", "ready", "needs_review", "needs_attention", "cancelled"];

type Counts = {
  total: number;
  active: number;
  ready: number;
  needsReview: number;
  needsAttention: number;
  cancelled: number;
  createdThisWeek: number;
};

const JobsPageContent: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [jobs, setJobs] = useState<V2Job[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; displayName?: string; name?: string }>>([]);

  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    Promise.allSettled([axios.get("/api/v2/templates")]).then(
      ([templateRes]) => {
        if (templateRes.status === "fulfilled") setTemplates(templateRes.value.data.templates || []);
      },
    );
  }, []);

  const params = useMemo(
    () => ({
      group: group === "all" ? undefined : group,
      search: debouncedQuery || undefined,
      language: language || undefined,
      aspectRatio: aspectRatio || undefined,
      templateId: templateId || undefined,
      sort,
      limit: 24,
    }),
    [group, debouncedQuery, language, aspectRatio, templateId, sort],
  );

  const load = useCallback(
    async (cursor?: string) => {
      const id = ++requestId.current;
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const response = await axios.get("/api/v2/jobs", {
          params: { ...params, cursor },
        });
        if (id !== requestId.current) return;
        const incoming: V2Job[] = response.data.jobs || [];
        setJobs((prev) => (cursor ? [...prev, ...incoming] : incoming));
        setNextCursor(response.data.page?.nextCursor);
        setHasMore(Boolean(response.data.page?.hasMore));
        if (response.data.counts) setCounts(response.data.counts);
        setError(null);
      } catch {
        if (id === requestId.current) setError(t("errors.loadFailed", { resource: t("errors.sourceJobs") }));
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [params, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh the first page on an interval so active productions keep moving,
  // without disturbing pages the operator has already loaded more of.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!loadingMore) void load();
    }, 6000);
    return () => clearInterval(timer);
  }, [load, loadingMore]);

  const resetFilters = () => {
    setGroup("all");
    setQuery("");
    setLanguage("");
    setAspectRatio("");
    setTemplateId("");
    setSort("newest");
  };

  const filtersActive =
    group !== "all" || debouncedQuery || language || aspectRatio || templateId || sort !== "newest";

  if (loading && jobs.length === 0) {
    return <JobsListSkeleton />;
  }

  return (
    <>
      <PageHeader
        title={t("productions.title")}
        eyebrow={t("productions.eyebrow")}
        description={t("productions.description")}
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => load()}>
              {t("common.refresh")}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
              {t("create.title")}
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {counts && (
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}>
            <StatCard label={t("productions.count.active")} value={String(counts.active)} />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard label={t("productions.count.ready")} value={String(counts.ready)} />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard label={t("productions.filter.needsReview")} value={String(counts.needsReview ?? 0)} />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard label={t("productions.count.needsAttention")} value={String(counts.needsAttention)} />
          </Grid>
        </Grid>
      )}

      <SectionCard>
        <Stack spacing={2}>
          <FilterTabs value={group} onChange={setGroup} options={GROUPS} />
          <SearchInput value={query} onChange={setQuery} placeholder={t("productions.searchPlaceholder")} />
          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={4}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("productions.language")}</InputLabel>
                <Select
                  label={t("productions.language")}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  <MenuItem value="">{t("videos.filter.allLanguages")}</MenuItem>
                  <MenuItem value="en">{t("create.language.english")}</MenuItem>
                  <MenuItem value="ar">{t("create.language.arabic")}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("videos.filter.aspect")}</InputLabel>
                <Select
                  label={t("videos.filter.aspect")}
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                >
                  <MenuItem value="">{t("videos.filter.allAspects")}</MenuItem>
                  <MenuItem value="9:16">{t("create.aspect.vertical")}</MenuItem>
                  <MenuItem value="16:9">{t("create.aspect.landscape")}</MenuItem>
                  <MenuItem value="1:1">{t("create.aspect.square")}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("templates.title")}</InputLabel>
                <Select
                  label={t("templates.title")}
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  <MenuItem value="">{t("common.all")}</MenuItem>
                  {templates.map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.displayName || template.name || template.id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("productions.sort")}</InputLabel>
                <Select
                  label={t("productions.sort")}
                  value={sort}
                  onChange={(event) => setSort(event.target.value as "newest" | "oldest")}
                >
                  <MenuItem value="newest">{t("productions.sortNewest")}</MenuItem>
                  <MenuItem value="oldest">{t("productions.sortOldest")}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {filtersActive && (
              <Grid item xs={12} sm={4} sx={{ display: "flex", alignItems: "center" }}>
                <Button onClick={resetFilters}>{t("productions.resetFilters")}</Button>
              </Grid>
            )}
          </Grid>
        </Stack>
      </SectionCard>

      <Stack spacing={1.5} sx={{ mt: 2.5 }}>
        {jobs.map((job) => (
          <Box key={job.id} sx={{ position: "relative" }}>
            <RecentJobCard job={job} onClick={() => navigate(`/jobs/${job.id}`)} />
            {job.failure?.message && (
              <Typography variant="caption" color="warning.main" sx={{ pl: 1 }}>
                {job.failure.message}
              </Typography>
            )}
          </Box>
        ))}

        {jobs.length === 0 && (
          <EmptyState
            title={filtersActive ? t("productions.emptyFiltered") : t("productions.emptyTitle")}
            description={
              filtersActive ? t("productions.emptyFilteredHint") : t("productions.emptyHint")
            }
            action={
              filtersActive ? (
                <Button variant="outlined" onClick={resetFilters}>
                  {t("productions.resetFilters")}
                </Button>
              ) : (
                <Button variant="contained" onClick={() => navigate("/create")}>
                  {t("create.title")}
                </Button>
              )
            }
          />
        )}

        {hasMore && (
          <Button
            variant="outlined"
            disabled={loadingMore}
            onClick={() => load(nextCursor)}
            sx={{ alignSelf: "center", mt: 1 }}
          >
            {loadingMore ? t("common.loading") : t("productions.loadMore")}
          </Button>
        )}
        {!hasMore && jobs.length > 0 && (
          <Chip label={t("productions.endOfList")} variant="outlined" sx={{ alignSelf: "center", mt: 1 }} />
        )}
      </Stack>
    </>
  );
};

export const JobsPage: React.FC = () => (
  <ErrorBoundary fallbackTitle="Productions Error">
    <JobsPageContent />
  </ErrorBoundary>
);

export default JobsPage;
