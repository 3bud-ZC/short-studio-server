import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ScienceIcon from "@mui/icons-material/ScienceOutlined";

import { ErrorBoundary, PageHeader, SectionCard, StatusBadge } from "../components/v2";
import { useI18n } from "../i18n";
import UpdateCenter from "../components/UpdateCenter";

/**
 * SYSTEM HEALTH
 * -------------
 * This page used to gate its first render on
 * `Promise.all([health, diagnostics, storage])`. `/system/diagnostics` contacts
 * every configured publishing platform over the network and then walks the
 * whole data directory; `/system/storage` walks it again. `Promise.all`
 * finishes with the slowest of the three, the browser requests carried no
 * client timeout, and the page rendered nothing at all until they all settled -
 * which is why it could sit on "Checking V2 system diagnostics…" indefinitely
 * whenever one external provider stopped answering.
 *
 * The fix is structural, not a longer timeout:
 *
 *   - First paint comes from `/system/health/fast`, where every check is
 *     individually bounded and none of them touches a provider API or storage.
 *   - The expensive report is opt-in behind "Run full diagnostics" and never
 *     blocks anything.
 *   - Every request here carries a client-side deadline, so a request that
 *     never settles can no longer hold the page.
 *   - Sections render independently: storage failing does not hide core status.
 */

/** Fast health must answer quickly; this deadline is a backstop, not the plan. */
const FAST_REQUEST_TIMEOUT_MS = 6000;

/** Deep diagnostics are allowed to be slow, but never unbounded. */
const DEEP_REQUEST_TIMEOUT_MS = 45_000;

type FastHealthItem = {
  id: string;
  section: "core" | "providers" | "storage" | string;
  status: string;
  optional: boolean;
  message: string;
  /** Translation key for the same detail; see the server contract. */
  messageKey?: string;
  latencyMs: number;
  technicalName?: string;
};

type FastHealthReport = {
  ok: boolean;
  attentionCount: number;
  status: string;
  items: FastHealthItem[];
  product: { version: string; stage: string; build: string; uptimeSeconds: number };
  checkedAt: string;
  durationMs: number;
  cached: boolean;
};

const ITEM_LABEL_KEYS: Record<string, string> = {
  application: "health.group.application",
  database: "health.group.database",
  videoEngine: "health.group.videoEngine",
  automation: "health.group.automation",
  voice: "health.group.voice",
  ai: "health.group.ai",
  mediaSources: "health.group.mediaSources",
  publishing: "health.group.publishing",
  storage: "health.group.storage",
};

const HealthItemCard: React.FC<{ item: FastHealthItem }> = ({ item }) => {
  const { t, format } = useI18n();
  return (
    <Card variant="outlined" sx={{ height: "100%", borderRadius: 2.5 }}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack spacing={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography variant="subtitle1">
              {t(ITEM_LABEL_KEYS[item.id] || "common.unknown")}
            </Typography>
            <StatusBadge status={item.status} />
          </Stack>
          {/* The server sends a translation key alongside its English wording.
              The key wins so an Arabic operator reads Arabic; `message` is the
              fallback for a key this build does not carry yet. */}
          <Typography variant="body2" color="text.secondary">
            {item.messageKey ? t(item.messageKey) : item.message}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {format.number(item.latencyMs)} ms
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

const SystemPageContent: React.FC = () => {
  const { t, format } = useI18n();
  const theme = useTheme();

  const [health, setHealth] = useState<FastHealthReport | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [deep, setDeep] = useState<any>(null);
  const [deepStorage, setDeepStorage] = useState<any>(null);
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);

  const [arabicReadiness, setArabicReadiness] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /**
   * Fast path. This is the only request the first paint waits on, and it is
   * allowed to fail without taking the page with it.
   */
  const loadFast = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const response = await axios.get("/api/v2/system/health/fast", {
        params: force ? { refresh: "true" } : undefined,
        timeout: FAST_REQUEST_TIMEOUT_MS,
      });
      setHealth(response.data);
      setHealthError(null);
    } catch {
      setHealthError(t("errors.healthLoadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void loadFast();
    // Arabic readiness is a local capability check, not a provider call, so it
    // is cheap enough to run alongside the fast path. It is deliberately
    // fire-and-forget: it can never block the page.
    axios
      .get("/api/v2/system/arabic-readiness", { timeout: FAST_REQUEST_TIMEOUT_MS })
      .then((response) => setArabicReadiness(response.data))
      .catch(() => setArabicReadiness(null));
  }, [loadFast]);

  /**
   * Deep path. Runs only when the customer asks, uses `allSettled` so one slow
   * or failing call cannot discard the other's result, and carries its own
   * deadline.
   */
  const runDeepDiagnostics = useCallback(async () => {
    setDeepRunning(true);
    setDeepError(null);
    const [report, storage] = await Promise.allSettled([
      axios.get("/api/v2/system/diagnostics", { timeout: DEEP_REQUEST_TIMEOUT_MS }),
      axios.get("/api/v2/system/storage", {
        params: { refresh: "true" },
        timeout: DEEP_REQUEST_TIMEOUT_MS,
      }),
    ]);

    if (report.status === "fulfilled") setDeep(report.value.data);
    if (storage.status === "fulfilled") setDeepStorage(storage.value.data);

    if (report.status === "rejected" && storage.status === "rejected") {
      setDeepError(t("health.deepFailed"));
    }
    setDeepRunning(false);
  }, [t]);

  const downloadBundle = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await axios.get("/api/v2/system/diagnostics/bundle", {
        responseType: "blob",
        timeout: DEEP_REQUEST_TIMEOUT_MS,
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `short_studio_diagnostics_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setDownloadError(t("errors.supportFileFailed"));
    } finally {
      setDownloading(false);
    }
  };

  const sections = useMemo(() => {
    const items = health?.items || [];
    return {
      core: items.filter((item) => item.section === "core"),
      providers: items.filter((item) => item.section === "providers"),
      storage: items.filter((item) => item.section === "storage"),
    };
  }, [health]);

  const storageRows = useMemo(() => {
    if (!deepStorage) return null;
    return [
      { labelKey: "health.storageVideos", bytes: deepStorage.videosStorageBytes || 0 },
      { labelKey: "health.storageCache", bytes: deepStorage.cacheStorageBytes || 0 },
      { labelKey: "health.storageModels", bytes: deepStorage.modelsStorageBytes || 0 },
      { labelKey: "health.storageBackups", bytes: deepStorage.backupsStorageBytes || 0 },
      { labelKey: "health.storageLogs", bytes: deepStorage.logsStorageBytes || 0 },
    ];
  }, [deepStorage]);

  const summaryOk = health?.ok ?? false;
  const attentionCount = health?.attentionCount ?? 0;

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t("health.title")}
        eyebrow={t("health.eyebrow")}
        description={t("health.description")}
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={downloadBundle}
              disabled={downloading}
            >
              {downloading ? t("health.generatingSupportFile") : t("health.downloadSupportFile")}
            </Button>
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={() => loadFast(true)}
              disabled={refreshing}
            >
              {t("common.refresh")}
            </Button>
          </Stack>
        }
      />

      {/* ------------------------------------------------------- top summary */}
      <Card
        variant="outlined"
        sx={{
          borderRadius: 3,
          borderColor: health ? (summaryOk ? theme.abud.success : theme.abud.warning) : "divider",
        }}
      >
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={2}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              {!health ? (
                <ScienceIcon sx={{ color: theme.abud.muted, fontSize: 30 }} />
              ) : summaryOk ? (
                <CheckCircleIcon sx={{ color: theme.abud.success, fontSize: 30 }} />
              ) : (
                <WarningAmberIcon sx={{ color: theme.abud.warning, fontSize: 30 }} />
              )}
              <Box>
                <Typography variant="h5">
                  {!health
                    ? t("health.checking")
                    : summaryOk
                      ? t("health.allOperational")
                      : attentionCount === 1
                        ? t("health.needAttentionOne")
                        : t("health.needAttention", { count: attentionCount })}
                </Typography>
                {health && (
                  <Typography variant="caption" color="text.secondary">
                    {t("health.lastChecked", { time: format.time(health.checkedAt) })}
                  </Typography>
                )}
              </Box>
            </Stack>

            {health && (
              <Stack direction="row" spacing={3}>
                <Box>
                  <Typography variant="overline" color="text.secondary" display="block">
                    {t("health.productVersion")}
                  </Typography>
                  {/* A version string is technical: kept left-to-right so it
                      does not reorder inside an Arabic interface. */}
                  <Typography variant="subtitle1" dir="ltr" sx={{ textAlign: "start" }}>
                    {health.product.version}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="overline" color="text.secondary" display="block">
                    {t("health.uptime")}
                  </Typography>
                  <Typography variant="subtitle1">
                    {t("health.uptimeMinutes", {
                      count: format.number(Math.round(health.product.uptimeSeconds / 60)),
                    })}
                  </Typography>
                </Box>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      {healthError && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => loadFast(true)}>{t("common.retry")}</Button>}>
          {healthError}
        </Alert>
      )}

      {/* Arabic readiness is a product policy statement, not a fault: without
          Local Voice (VoiceTut/KemeTone) or an explicit ElevenLabs connection,
          Arabic narration is blocked but English is unaffected, and the banner
          says exactly that. `ready` already reflects either route - see
          /system/arabic-readiness - so this only shows when neither is set up. */}
      {arabicReadiness && !arabicReadiness.ready && (
        <Alert
          severity="info"
          action={
            <Button size="small" variant="contained" href="/integrations">
              {t("health.configureElevenLabs")}
            </Button>
          }
        >
          <strong>{t("health.arabicNotReady")}</strong>
          <br />
          {t("health.arabicNotReadyBody")}
        </Alert>
      )}

      {/* -------------------------------------------------------------- core */}
      <SectionCard title={t("health.sectionCore")}>
        <Grid container spacing={2}>
          {sections.core.map((item) => (
            <Grid item xs={12} sm={6} md={3} key={item.id}>
              <HealthItemCard item={item} />
            </Grid>
          ))}
          {sections.core.length === 0 && (
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                {t("health.checking")}
              </Typography>
            </Grid>
          )}
        </Grid>
      </SectionCard>

      {/* --------------------------------------------------------- providers */}
      <SectionCard title={t("health.sectionProviders")}>
        <Grid container spacing={2}>
          {sections.providers.map((item) => (
            <Grid item xs={12} sm={6} md={3} key={item.id}>
              <HealthItemCard item={item} />
            </Grid>
          ))}
          {sections.providers.length === 0 && (
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                {t("health.checking")}
              </Typography>
            </Grid>
          )}
        </Grid>
      </SectionCard>

      {/* ----------------------------------------------------------- storage */}
      <SectionCard title={t("health.sectionStorage")}>
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <Stack spacing={2}>
              {sections.storage.map((item) => (
                <HealthItemCard key={item.id} item={item} />
              ))}
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            {storageRows ? (
              <Stack spacing={1.25}>
                {storageRows.map((row) => (
                  <Stack
                    key={row.labelKey}
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Typography variant="body2" color="text.secondary">
                      {t(row.labelKey)}
                    </Typography>
                    <Typography variant="body2" fontWeight={650}>
                      {format.bytes(row.bytes)}
                    </Typography>
                  </Stack>
                ))}
                <Divider />
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle1">{t("health.storageTotal")}</Typography>
                  <Typography variant="subtitle1" color="primary.main">
                    {format.bytes(deepStorage?.usedProjectStorageBytes || 0)}
                  </Typography>
                </Stack>
              </Stack>
            ) : (
              // Measuring storage means walking the whole data directory, which
              // is exactly the kind of work the fast path must not do. The page
              // is honest that the figure is not known yet.
              <Typography variant="body2" color="text.secondary">
                {t("health.storageNotMeasured")}
              </Typography>
            )}
          </Grid>
        </Grid>
      </SectionCard>

      {/* ----------------------------------------------------------- updates */}
      <SectionCard title={t("health.sectionUpdates")}>
        <UpdateCenter />
      </SectionCard>

      {/* ---------------------------------------------- advanced diagnostics */}
      <SectionCard
        title={t("health.sectionAdvanced")}
        description={t("health.deepDescription")}
        actions={
          <Button
            variant="outlined"
            startIcon={<ScienceIcon />}
            onClick={runDeepDiagnostics}
            disabled={deepRunning}
          >
            {deepRunning ? t("health.runningDeep") : t("health.runDeep")}
          </Button>
        }
      >
        <Stack spacing={2}>
          {deepRunning && <LinearProgress />}
          {deepError && <Alert severity="warning">{deepError}</Alert>}
          {downloadError && <Alert severity="warning">{downloadError}</Alert>}

          {!deep && !deepRunning && (
            <Typography variant="body2" color="text.secondary">
              {t("health.deepNotRun")}
            </Typography>
          )}

          {deep && (
            <Stack spacing={2}>
              {/* Provider reachability, as actually measured by the deep run.
                  A provider that was never configured reports `not_configured`
                  and is shown as such rather than as a failure. */}
              <Grid container spacing={2}>
                {(deep.providers || []).map((provider: any) => (
                  <Grid item xs={12} sm={6} md={3} key={provider.id}>
                    <Card variant="outlined" sx={{ height: "100%", borderRadius: 2.5 }}>
                      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                        <Stack spacing={1}>
                          <Typography variant="subtitle2" dir="ltr" sx={{ textAlign: "start" }}>
                            {provider.displayName}
                          </Typography>
                          <StatusBadge status={provider.status} />
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              {/* Container names, pool state and log lines live behind this
                  disclosure. The normal view never shows them. */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle1">{t("health.advancedDetails")}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }}>
                      {(health?.items || []).map((item) => (
                        <Chip
                          key={item.id}
                          size="small"
                          variant="outlined"
                          dir="ltr"
                          label={`${item.technicalName || item.id}: ${item.status}`}
                        />
                      ))}
                    </Stack>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        bgcolor: theme.abud.backgroundAlt,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        fontSize: "0.78rem",
                        maxHeight: 320,
                        overflow: "auto",
                        borderRadius: 2,
                      }}
                      dir="ltr"
                    >
                      {(deep.sanitizedLogs || []).map((line: string, index: number) => (
                        <Box key={index} sx={{ py: 0.25, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {line}
                        </Box>
                      ))}
                    </Paper>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          )}
        </Stack>
      </SectionCard>
    </Stack>
  );
};

export const SystemPage: React.FC = () => (
  <ErrorBoundary>
    <SystemPageContent />
  </ErrorBoundary>
);

export default SystemPage;
