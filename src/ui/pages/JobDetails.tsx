import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MovieIcon from "@mui/icons-material/Movie";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useNavigate, useParams } from "react-router-dom";
import {
  bidiProps,
  isArabicText,
  EmptyState,
  ErrorBoundary,
  JobDetailsSkeleton,
  PageHeader,
  ProgressDisplay,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import { useI18n, useT } from "../i18n";
import { localizedStatus } from "../i18n/status";
import type { CustomerFailure, CustomerTimelineStep, V2Job, V2JobEvent } from "./v2Types";
import { withMediaAccessToken } from "../utils/auth";
import { isFreeCost, isUsageBasedCost, videoCostLabel } from "../../types/costDisplay";
import { QualityReviewPanel } from "../components/QualityReviewPanel";
import {
  PIPELINE_STAGES,
  RETRYABLE_STAGES,
  aspectLabelKey,
  artifactStateLabelKey,
  dialectLabelKey,
  languageLabelKey,
  mediaStrategyLabelKey,
  qualityLabelKey,
  stageLabelKey,
  voiceProviderLabelKey,
} from "./displayLabels";

const JobDetailsContent: React.FC = () => {
  const tt = useT();
  const { jobId, id } = useParams<{ jobId?: string; id?: string }>();
  const effectiveId = jobId || id;
  const navigate = useNavigate();

  const { t, format, locale } = useI18n();
  const [job, setJob] = useState<V2Job | null>(null);
  const [events, setEvents] = useState<V2JobEvent[]>([]);
  const [timeline, setTimeline] = useState<CustomerTimelineStep[]>([]);
  const [failure, setFailure] = useState<CustomerFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryingStage, setRetryingStage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const load = useCallback(async () => {
    if (!effectiveId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const [jobResponse, eventsResponse] = await Promise.all([
        axios.get(`/api/v2/jobs/${effectiveId}`),
        axios.get(`/api/v2/jobs/${effectiveId}/events`),
      ]);
      setJob(jobResponse.data.job || null);
      setTimeline(jobResponse.data.timeline || jobResponse.data.job?.timeline || []);
      setFailure(jobResponse.data.failure || jobResponse.data.job?.failure || null);
      setEvents(eventsResponse.data.events || []);
      setError(null);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setNotFound(true);
      } else {
        setError(t("productions.detail.loadErrorTitle"));
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveId]);

  useEffect(() => {
    load();
    if (!effectiveId) return;

    let source: EventSource | null = null;
    try {
      source = new EventSource(withMediaAccessToken(`/api/v2/jobs/${effectiveId}/events`));
      source.addEventListener("job-event", (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as V2JobEvent;
          setEvents((prev) =>
            [...prev.filter((item) => item.id !== parsed.id), parsed].sort((a, b) => a.id - b.id),
          );
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: parsed.status,
                  progress: parsed.progress,
                  currentStage: parsed.stage,
                  updatedAt: parsed.createdAt,
                }
              : prev,
          );
          if (["ready", "failed", "canceled"].includes(parsed.status)) {
            setTimeout(load, 800);
          }
        } catch (parseError) {
          console.warn("Failed to parse SSE event:", parseError);
        }
      });
      source.onerror = () => {
        source?.close();
      };
    } catch (sseErr) {
      console.warn("SSE connection error:", sseErr);
    }

    return () => {
      source?.close();
    };
  }, [effectiveId, load]);

  const copyId = () => {
    if (!effectiveId) return;
    navigator.clipboard.writeText(effectiveId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const latestEvent = useMemo(() => events[events.length - 1], [events]);
  // A reviewable production has a real, playable output. Treating it like a
  // failure here is what used to hide a finished 1080p video from its owner.
  const hasOutput = job?.status === "ready" || job?.status === "needs_review";
  const videoId = job?.output?.videoId || (hasOutput ? job?.id : undefined);
  const isPromptMode = job?.creationMode === "prompt";
  const cost = job?.costEstimate || job?.productionSpec?.costEstimate;
  const costIsFree = isFreeCost(cost as any);
  const costIsUsageBased = isUsageBasedCost(cost as any);
  const costText = videoCostLabel(cost as any);
  const failureMessage = failure?.category
    ? t(`productions.failure.${failure.category}`)
    : (failure?.messageAr || failure?.message || t("productions.failure.UNKNOWN"));
  const stageKeys = ["planning", "media", "voice", "captions", "render", "mastering", "validation"];

  const isActive = job
    ? !["ready", "needs_review", "failed", "canceled"].includes(job.status)
    : false;
  // A reviewable production can be retried too: the customer may want a better
  // take, and the retry reuses everything already produced.
  const canRetry = job ? ["needs_review", "failed", "canceled"].includes(job.status) : false;

  const retryProduction = async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      const res = await axios.post(`/api/v2/jobs/${job.id}/retry`);
      navigate(`/jobs/${res.data.job.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || t("errors.loadFailed", { resource: t("errors.sourceJobs") }));
    } finally {
      setBusyAction(false);
    }
  };

  const cancelProduction = async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      await axios.post(`/api/v2/jobs/${job.id}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || t("errors.loadFailed", { resource: t("errors.sourceJobs") }));
    } finally {
      setBusyAction(false);
    }
  };

  const retryStage = async (stage: string) => {
    if (!job) return;
    setRetryingStage(stage);
    try {
      const res = await axios.post(`/api/v2/jobs/${job.id}/stages/${stage}/retry`);
      setJob(res.data.job);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || t("productions.detail.retryStageFailed"));
    } finally {
      setRetryingStage(null);
    }
  };

  // 1. Loading State
  if (loading && !job) {
    return <JobDetailsSkeleton />;
  }

  // 2. 404 / Not Found State
  if (notFound || (!job && !loading && !error)) {
    return (
      <Box sx={{ py: 4 }}>
        <EmptyState
          title={t("productions.detail.notFoundTitle")}
          description={t("productions.detail.notFoundBody")}
          action={
            <Button variant="contained" startIcon={<ArrowBackIcon />} onClick={() => navigate("/jobs")}>
              {t("common.back")}
            </Button>
          }
        />
      </Box>
    );
  }

  // 3. API Error State
  if (error && !job) {
    return (
      <Box sx={{ py: 4 }}>
        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: "error.light", bgcolor: "#fff5f5" }}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h6" color="error.main" fontWeight={800}>
                {t("productions.detail.loadErrorTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {error}
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <Button variant="contained" startIcon={<RefreshIcon />} onClick={load}>
                  {t("common.retry")}
                </Button>
                <Button variant="outlined" onClick={() => navigate("/jobs")}>
                  {t("common.back")}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  }

  if (!job) return null;

  const isArabicTitle = isArabicText(job.title);
  const displayTitle = job.title || job.templateId || t("productions.detail.untitled");

  return (
    <>
      <PageHeader
        title={displayTitle}
        eyebrow={t("productions.title")}
        description={
          `${isPromptMode ? t("productions.typePrompt") : t("productions.typeTemplate")}` +
          ` · ${format.dateTime(job.createdAt)}`
        }
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => navigate("/jobs")}>
              {t("common.back")}
            </Button>
            {canRetry && (
              <Button
                variant="contained"
                color="warning"
                startIcon={<RefreshIcon />}
                disabled={busyAction}
                onClick={retryProduction}
              >
                {t("productions.retry")}
              </Button>
            )}
            {isActive && (
              <Button variant="outlined" color="error" disabled={busyAction} onClick={cancelProduction}>
                {t("productions.cancel")}
              </Button>
            )}
            {hasOutput && videoId && (
              <>
                <Button
                  variant="contained"
                  startIcon={<MovieIcon />}
                  onClick={() => navigate(`/video/${videoId}`)}
                >
                  {t("common.preview")}
                </Button>
                <Button
                  component="a"
                  href={withMediaAccessToken(`/api/videos/${videoId}/download`)}
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                >
                  {t("videos.download")}
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<SendIcon />}
                  onClick={() => navigate(`/publishing?videoId=${videoId}`)}
                >
                  {t("videos.publish")}
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2.5}>
        {/* =========================================================================
            LEFT COLUMN: Progress, Video Result, Script/Prompt, Timeline
            ========================================================================= */}
        <Grid item xs={12} lg={7}>
          <Stack spacing={2.5}>
            {/* 1. Current Progress & Execution State */}
            <SectionCard
              title={t("productions.detail.executionProgress")}
              actions={<StatusBadge status={job.customerStatus || job.status} />}
            >
              <Stack spacing={2}>
                <ProgressDisplay
                  stage={job.currentStage}
                  progress={job.progress}
                  timestamp={latestEvent?.createdAt || job.updatedAt}
                  message={
                    job.status === "failed"
                      ? (failureMessage || t("productions.failure.UNKNOWN"))
                      : (latestEvent?.message || t("productions.detail.orchestrationActive"))
                  }
                />

                <Divider />

                <Grid container spacing={1.5}>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      {t("productions.detail.started")}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : t("productions.detail.pending")}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      {t("productions.detail.completed")}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : t("productions.detail.inProgress")}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      {t("productions.detail.durationLabel")}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {job.startedAt
                        ? format.durationMs(
                            (job.completedAt ? new Date(job.completedAt).getTime() : Date.now()) -
                              new Date(job.startedAt).getTime(),
                          )
                        : t("productions.detail.notStarted")}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      {t("productions.detail.lastUpdate")}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {new Date(job.updatedAt).toLocaleTimeString()}
                    </Typography>
                  </Grid>
                </Grid>

                {job.status === "failed" && !job.qualityReview && (
                  <Alert severity="error" icon={<ErrorIcon />} sx={{ mt: 1 }}>
                    <Typography fontWeight={700}>{t("productions.detail.executionError")}</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {failureMessage || t("productions.failure.UNKNOWN")}
                    </Typography>
                  </Alert>
                )}
              </Stack>
            </SectionCard>

            {job.qualityReview && (
              <QualityReviewPanel
                review={job.qualityReview}
                onRetry={canRetry ? retryProduction : undefined}
                retrying={busyAction}
              />
            )}

            {failure && !job.qualityReview && (
              <SectionCard title={t("productions.failureTitle")}>
                <Stack spacing={1.5}>
                  <Alert severity="warning" icon={<ErrorIcon />}>
                    {failureMessage || t("productions.failure.UNKNOWN")}
                  </Alert>
                  <Typography variant="caption" color="text.secondary">
                    {t("productions.supportCode")}: <code>{failure.supportCode}</code>
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    {canRetry && (
                      <Button
                        variant="contained"
                        color="warning"
                        startIcon={<RefreshIcon />}
                        disabled={busyAction}
                        onClick={retryProduction}
                      >
                        {t("productions.retry")}
                      </Button>
                    )}
                    {failure.action && failure.action.href !== `/jobs/${job.id}` && (
                      <Button variant="outlined" onClick={() => navigate(failure.action!.href)}>
                        {failure.action.label}
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </SectionCard>
            )}

            {timeline.length > 0 && (
              <SectionCard title={t("productions.timeline")}>
                <Stack spacing={1}>
                  {timeline.map((step) => {
                    const color =
                      step.state === "failed"
                        ? "error.main"
                        : step.state === "done"
                          ? "success.main"
                          : step.state === "active"
                            ? "primary.main"
                            : "text.disabled";
                    const stateLabel =
                      step.state === "failed"
                        ? t("productions.stepFailed")
                        : step.state === "done"
                          ? t("productions.stepDone")
                          : step.state === "active"
                            ? t("productions.stepActive")
                            : t("productions.stepPending");
                    return (
                      <Stack
                        key={step.key}
                        direction="row"
                        spacing={1.5}
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                          <Typography variant="body2" fontWeight={step.state === "active" ? 800 : 500}>
                            {t(`productions.timeline.${step.key}`)}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                          {step.at ? new Date(step.at).toLocaleTimeString() : stateLabel}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </SectionCard>
            )}

            <SectionCard title={t("productions.detail.checkpoints")}>
              <Stack spacing={1}>
                <Alert severity="info">{t("productions.detail.checkpointsHelp")}</Alert>
                {PIPELINE_STAGES.map((stage) => {
                  const checkpoint = (job.checkpoint as any)?.[stage];
                  const timing = job.stageTimings?.[`${stage}Ms`];
                  const artifactState = checkpoint?.status === "failed"
                    ? "FAILED"
                    : checkpoint?.artifacts?.reused
                      ? "REUSED"
                      : checkpoint?.artifacts?.invalidated
                        ? "INVALIDATED"
                        : checkpoint?.status === "completed"
                          ? "GENERATED"
                          : "PENDING";
                  const artifactType = checkpoint?.artifacts?.type || checkpoint?.artifacts?.artifactId ? stage : undefined;
                  return (
                    <Card key={stage} variant="outlined" sx={{ p: 1.25, borderRadius: 1 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography variant="body2" fontWeight={800}>
                            {t(stageLabelKey(stage))}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t(localizedStatus(checkpoint?.status || "pending").key)}
                            {" · "}
                            {t("productions.detail.attempt", { count: format.number(checkpoint?.attempt || 0) })}
                            {timing ? ` · ${format.durationMs(timing)}` : ""}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip size="small" label={t(artifactStateLabelKey(artifactState))} color={artifactState === "FAILED" ? "error" : artifactState === "REUSED" ? "success" : artifactState === "INVALIDATED" ? "warning" : "default"} />
                          {(RETRYABLE_STAGES as readonly string[]).includes(stage) && (
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={Boolean(retryingStage)}
                            onClick={() => retryStage(stage)}
                          >
                            {retryingStage === stage ? t("productions.detail.retryingStage") : t("productions.detail.retryStage")}
                          </Button>
                          )}
                        </Stack>
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            </SectionCard>

            {/* 2. Ready Video Card (When Ready) */}
            {hasOutput && videoId && (
              <SectionCard
                title={t("productions.detail.videoOutput")}
                actions={<StatusBadge status={job.status} />}
              >
                <Stack spacing={2}>
                  <Box
                    sx={{
                      position: "relative",
                      borderRadius: 2,
                      overflow: "hidden",
                      bgcolor: "#000000",
                      maxHeight: 420,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <video
                      src={withMediaAccessToken(`/api/short-video/${videoId}`)}
                      poster={withMediaAccessToken(`/api/videos/${videoId}/thumbnail`)}
                      controls
                      style={{
                        maxHeight: 400,
                        width: "100%",
                        objectFit: "contain",
                        borderRadius: 8,
                      }}
                    />
                  </Box>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">
                      {t("productions.detail.videoOutputNote")}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<MovieIcon />}
                        onClick={() => navigate(`/video/${videoId}`)}
                      >
                        {t("productions.detail.fullDetails")}
                      </Button>
                      <Button
                        component="a"
                        href={withMediaAccessToken(`/api/videos/${videoId}/download`)}
                        variant="outlined"
                        size="small"
                        startIcon={<DownloadIcon />}
                      >
                        {t("videos.download")}
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </SectionCard>
            )}

            {/* 3. Original Creative Prompt / Script */}
            {(job.originalPrompt || job.productionSpec?.userPrompt) && (
              <SectionCard
                title={t("productions.detail.creativePrompt")}
                actions={<Chip size="small" label={isPromptMode ? t("productions.detail.sourcePrompt") : t("productions.detail.sourceTemplate")} color="primary" variant="outlined" />}
              >
                <Box
                  {...bidiProps(job.originalPrompt || job.productionSpec?.userPrompt)}
                  sx={{
                    p: 2,
                    borderRadius: 1.5,
                    bgcolor: "action.hover",
                    border: "1px solid",
                    borderColor: "divider",
                    fontStyle: "italic",
                    whiteSpace: "pre-wrap",
                    fontSize: "0.95rem",
                  }}
                >
                  "{job.originalPrompt || job.productionSpec?.userPrompt}"
                </Box>

                {/* Scene breakdown if available in productionSpec */}
                {job.productionSpec?.scenes && job.productionSpec.scenes.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                      {t("productions.detail.scenes", { count: format.number(job.productionSpec.scenes.length) })}
                    </Typography>
                    <Stack spacing={1}>
                      {job.productionSpec.scenes.map((scene: any, idx: number) => {
                        const isArabicNarration = isArabicText(scene.narration);
                        return (
                          <Card key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                            <Stack spacing={0.5}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" fontWeight={800} color="primary.main">
                                  {t("productions.detail.sceneLabel", { index: format.number(idx + 1) })}
                                  {" · "}
                                  {format.duration(scene.durationSeconds || 6)}
                                </Typography>
                              </Stack>
                              <Typography
                                variant="body2"
                                dir={isArabicNarration ? "rtl" : "ltr"}
                                sx={{ textAlign: isArabicNarration ? "right" : "left", fontWeight: 500 }}
                              >
                                {scene.narration}
                              </Typography>
                              {scene.onScreenText && (
                                <Typography variant="caption" color="text.secondary">
                                  {t("productions.detail.sceneOverlay")}: <strong>{scene.onScreenText}</strong>
                                </Typography>
                              )}
                            </Stack>
                          </Card>
                        );
                      })}
                    </Stack>
                  </Box>
                )}
              </SectionCard>
            )}

            {/* 4. Live Progress Timeline */}
            <SectionCard
              title={t("productions.detail.orchestration")}
              description={t("productions.detail.orchestrationDesc")}
            >
              <Stack spacing={1}>
                {events.map((event) => {
                  const isArabicMsg = isArabicText(event.message);
                  return (
                    <Card key={event.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
                        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography fontWeight={650} variant="body2">{tt(localizedStatus(event.stage || event.status).key)}</Typography>
                            <StatusBadge status={event.status} />
                          </Stack>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            dir={isArabicMsg ? "rtl" : "ltr"}
                            sx={{ textAlign: isArabicMsg ? "right" : "left" }}
                          >
                            {event.message}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                          {event.progress}% · {new Date(event.createdAt).toLocaleTimeString()}
                        </Typography>
                      </Stack>
                    </Card>
                  );
                })}
                {events.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t("productions.detail.noEvents")}
                  </Typography>
                )}
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>

        {/* =========================================================================
            RIGHT COLUMN: Production Specs, Providers, Technical Accordion
            ========================================================================= */}
        <Grid item xs={12} lg={5}>
          <Stack spacing={2.5}>
            {/* 1. Production Overview */}
            <SectionCard title={t("productions.detail.specs")}>
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.creationMode")}</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {isPromptMode ? t("productions.typePrompt") : t("productions.typeTemplate")}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.languageDialect")}</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {t(languageLabelKey(job.language))}
                    {dialectLabelKey(job.dialect) ? ` · ${t(dialectLabelKey(job.dialect)!)}` : ""}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.aspectRatio")}</Typography>
                  <Typography variant="body2" fontWeight={700}>{t(aspectLabelKey(job.aspectRatio))}</Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.targetDuration")}</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {format.duration(job.productionSpec?.durationSeconds || job.durationSeconds)}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.qualityProfile")}</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {t(qualityLabelKey(job.qualityProfile))}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.mediaStrategy")}</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {t(mediaStrategyLabelKey(job.visualSource || job.visualMode))}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.voiceSynth")}</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {t(voiceProviderLabelKey(job.voiceProvider))}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{t("productions.detail.estimatedCost")}</Typography>
                  <Chip
                    size="small"
                    color={costIsFree ? "success" : costIsUsageBased ? "warning" : "default"}
                    label={costIsFree ? t("productions.detail.costFree") : costText}
                    sx={{ fontWeight: 700 }}
                  />
                </Stack>
              </Stack>
            </SectionCard>

            {/* 2. Production snapshots — frozen at production time (V2.3-04/05). */}
            {(job.snapshots?.brand || job.snapshots?.template || job.snapshots?.character) && (
              <SectionCard title={t("productions.overview")}>
                <Stack spacing={1.25}>
                  {job.snapshots?.brand && (
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("productions.snapshotBrand")}
                      </Typography>
                      <Typography variant="body2" fontWeight={700}>
                        {job.snapshots.brand.name || "—"}
                        {job.snapshots.brand.revision
                          ? ` · ${t("productions.revision", { n: job.snapshots.brand.revision })}`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                  {job.snapshots?.template && (
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("productions.snapshotTemplate")}
                      </Typography>
                      <Typography variant="body2" fontWeight={700}>
                        {job.snapshots.template.name || job.snapshots.template.id || "—"}
                        {job.snapshots.template.revision
                          ? ` · ${t("productions.revision", { n: job.snapshots.template.revision })}`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                  {job.snapshots?.character && (
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("productions.snapshotCharacter")}
                      </Typography>
                      <Typography variant="body2" fontWeight={700}>
                        {job.snapshots.character.name || job.snapshots.character.id || "—"}
                        {job.snapshots.character.revision
                          ? ` · ${t("productions.revision", { n: job.snapshots.character.revision })}`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                </Stack>
              </SectionCard>
            )}

            {/* 3. Advanced details — collapsed, sanitized (no paths/tokens/stack). */}
            <Accordion variant="outlined" sx={{ borderRadius: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2" fontWeight={800}>
                  {t("productions.advanced")}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      {t("productions.detail.jobId")}: <code>{format.technical(job.id)}</code>
                      {videoId ? <> · {t("productions.detail.videoIdLabel")}: <code>{format.technical(videoId)}</code></> : null}
                    </Typography>
                    <Button size="small" variant="text" startIcon={<ContentCopyIcon fontSize="small" />} onClick={copyId}>
                      {copied ? t("productions.detail.copied") : t("productions.detail.copyId")}
                    </Button>
                  </Stack>

                  {failure?.supportCode && (
                    <Typography variant="caption" color="text.secondary">
                      {t("productions.supportCode")}: <code>{failure.supportCode}</code>
                    </Typography>
                  )}

                  {job.technicalError && (
                    <Alert severity="warning" sx={{ fontSize: "0.8rem" }}>
                      <AlertTitle fontWeight={700}>{t("productions.detail.technicalDetail")}</AlertTitle>
                      {job.technicalError}
                    </Alert>
                  )}

                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    {t("productions.detail.diagnostics")}
                  </Typography>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 11,
                      background: "#0f172a",
                      color: "#38bdf8",
                      padding: 12,
                      borderRadius: 6,
                      maxHeight: 280,
                      overflowY: "auto",
                    }}
                  >
                    {JSON.stringify(
                      (job as any).advanced || {
                        stageTimings: job.stageTimings,
                        checkpoint: job.checkpoint,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
};

export const JobDetails: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="">
      <JobDetailsContent />
    </ErrorBoundary>
  );
};

export default JobDetails;
