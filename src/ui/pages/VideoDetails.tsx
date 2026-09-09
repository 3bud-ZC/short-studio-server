import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SendIcon from "@mui/icons-material/Send";
import RefreshIcon from "@mui/icons-material/Refresh";
import YouTubeIcon from "@mui/icons-material/YouTube";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TelegramIcon from "@mui/icons-material/Telegram";
import TwitterIcon from "@mui/icons-material/Twitter";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBoundary,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import { ReviewPublishModal } from "../components/publishing/ReviewPublishModal";
import type { V2Job, VideoItem, VideoPublishingStatus, VideoRevisionItem } from "./v2Types";
import { withMediaAccessToken } from "../utils/auth";
import { isFreeCost, videoCostLabel } from "../../types/costDisplay";
import { useI18n, useT } from "../i18n";
import { localizedStatus } from "../i18n/status";
import { QualityReviewPanel } from "../components/QualityReviewPanel";
import {
  aspectLabelKey,
  dialectLabelKey,
  languageLabelKey,
  mediaStrategyLabelKey,
  qualityLabelKey,
  voiceProviderLabelKey,
} from "./displayLabels";

function formatFileSize(bytes?: number): string {
  if (!bytes) return "Unknown";
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Production evidence helpers. Each returns an empty string when the field is
 * genuinely unknown so the row can be omitted rather than rendering "undefined".
 */
const CAPTION_TIMING_LABELS: Record<string, string> = {
  elevenlabs_alignment: "ElevenLabs Alignment",
  whisper: "Whisper",
  deterministic_fallback: "Deterministic Fallback",
};

function captionTimingLabel(video: any): string {
  const source =
    video?.captionTimingSource ||
    video?.voiceArtifacts?.[0]?.captionTimingSource ||
    video?.voiceArtifacts?.[0]?.timingSource;
  if (!source) return "N/A";
  return CAPTION_TIMING_LABELS[source] || String(source);
}

/**
 * Internal identifiers are how the engine talks to itself; a customer reading
 * Video Details should not meet them. Browser QA found `motion_canvas`,
 * `punch_in`, `zoom_out` and `clean_professional` rendered verbatim in the
 * normal (non-collapsed) view. Anything not in a map degrades to a
 * de-underscored, capitalised form rather than being dropped.
 */
const PROVIDER_LABELS: Record<string, string> = {
  motion_canvas: "Short Studio Motion",
  abud_motion: "Short Studio Motion",
  abud_mockup: "Short Studio Mockup",
  pexels: "Pexels",
  pixabay: "Pixabay",
  uploaded_media: "Your uploads",
  product_composition: "Product composition",
  local_image: "Local image",
};

const MOTION_LABELS: Record<string, string> = {
  punch_in: "Punch in",
  slow_zoom: "Slow zoom",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  drift_out: "Drift out",
  drift_left: "Drift left",
  drift_right: "Drift right",
  pan_left: "Pan left",
  pan_right: "Pan right",
  whip_in: "Whip in",
  static: "Hold",
};

const CAPTION_LABELS: Record<string, string> = {
  social_ad: "Social Ad",
  clean_professional: "Clean Professional",
  kinetic_phrase: "Kinetic Phrase",
  minimal: "Minimal",
  bold: "Bold",
  clean: "Clean",
  none: "None",
};

function humanise(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function labelWith(map: Record<string, string>, value?: string): string {
  if (!value) return "";
  const key = String(value).toLowerCase();
  return map[key] || humanise(String(value));
}

function labelList(map: Record<string, string>, values?: string[]): string {
  return (values || []).map((v) => labelWith(map, v)).filter(Boolean).join(", ");
}

/** Distinct visual treatments the plan actually used, most used first. */
function creativeTreatments(video: any): string {
  const counts = video?.creativePlan?.treatmentCounts as Record<string, number> | undefined;
  if (!counts || Object.keys(counts).length === 0) return "";
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([treatment, count]) => `${treatment.replace(/_/g, " ").toLowerCase()} x${count}`)
    .join(", ");
}

/** Only the brand fields the customer really supplied; never the derived ones. */
function suppliedBrandFields(video: any): string {
  const sources = video?.brandStyle?.sources as Record<string, string> | undefined;
  if (!sources) return "";
  return Object.entries(sources)
    .filter(([, source]) => source === "customer")
    .map(([field]) => field.replace(/([A-Z])/g, " $1").toLowerCase().trim())
    .join(", ");
}

function sourceBreakdown(video: any): string {
  const counts = video?.sourceTypeCounts || video?.editDecisionList?.sourceTypeCounts;
  if (!counts || typeof counts !== "object") return "";
  const labels: Record<string, string> = {
    stock: "Stock",
    mockup: "Website Mockup",
    motion: "Motion",
    upload: "Upload",
    image: "Image",
  };
  const parts = Object.entries(counts)
    .filter(([, value]) => typeof value === "number" && value > 0)
    .map(([key, value]) => `${labels[key] || key} ${value}`);
  return parts.join(" · ");
}

function providerReport(video: any) {
  const generatedShots =
    video?.selectedVisuals?.filter((item: any) => item?.source === "ai" || item?.source === "local_ai").length ??
    video?.productionSpec?.metadata?.uiContract?.heroShotAllocation?.filter((item: any) => item?.source === "generated").length ??
    0;
  return {
    visualSources: labelList(PROVIDER_LABELS, video?.visualProvidersUsed) || sourceBreakdown(video) || "Free stock / local media",
    generatedShots,
    externalCost: videoCostLabel(video?.costEstimate),
    voice: voiceEvidence(video) || (video?.voiceProvider === "elevenlabs" ? "ElevenLabs" : video?.voiceProvider || "Local / Auto"),
  };
}

function voiceEvidence(video: any): string {
  const artifact = video?.voiceArtifacts?.[0];
  if (!artifact?.provider) return "";
  const parts = [artifact.provider === "elevenlabs" ? "ElevenLabs" : artifact.provider];
  const name = video?.voiceName || artifact.voiceName;
  if (name) parts.push(String(name));
  if (artifact.voicePreset) parts.push(String(artifact.voicePreset).replaceAll("_", " "));
  return parts.join(" · ");
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

const VideoDetailsContent: React.FC = () => {
  const tt = useT();
  const { format } = useI18n();
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [job, setJob] = useState<V2Job | null>(null);
  const [pubStatus, setPubStatus] = useState<VideoPublishingStatus | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revisions, setRevisions] = useState<VideoRevisionItem[]>([]);
  const [revisionText, setRevisionText] = useState("");
  const [mediaSceneIndex, setMediaSceneIndex] = useState(0);
  const [captionProfile, setCaptionProfile] = useState<"none" | "clean" | "bold" | "minimal">("bold");

  const fetchDetails = () => {
    if (!videoId) return;
    Promise.allSettled([
      axios.get(`/api/videos/${videoId}`),
      axios.get(`/api/v2/jobs/${videoId}`),
      axios.get(`/api/v2/videos/${videoId}/publishing`),
    ]).then(([videoResult, jobResult, pubResult]) => {
      if (videoResult.status === "fulfilled") {
        setVideo(videoResult.value.data);
      } else {
        setError("Video metadata could not be loaded.");
      }
      if (jobResult.status === "fulfilled") setJob(jobResult.value.data.job);
      if (pubResult.status === "fulfilled") setPubStatus(pubResult.value.data);
      axios.get(`/api/v2/videos/${videoId}/revisions`)
        .then((res) => setRevisions(res.data.revisions || []))
        .catch(() => setRevisions([]));
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchDetails();
  }, [videoId]);

  const copy = (path: string, label: string) => {
    navigator.clipboard.writeText(`${window.location.origin}${path}`).then(() => {
      setFeedback(`${label} copied to clipboard.`);
      setTimeout(() => setFeedback(null), 2200);
    });
  };

  const deleteVideo = async () => {
    if (!videoId) return;
    setConfirmDelete(false);
    try {
      await axios.delete(`/api/short-video/${videoId}`);
      navigate("/videos");
    } catch {
      setError("Failed to delete video.");
    }
  };

  const createVoiceRevision = async () => {
    if (!videoId) return;
    try {
      const res = await axios.post(`/api/v2/videos/${videoId}/revisions/voice`, {
        spokenNarration: revisionText || undefined,
        reason: "Voice-only revision from Video Details",
      });
      setFeedback(`Voice revision queued: ${res.data.job.id}`);
      setRevisionText("");
      fetchDetails();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Voice revision failed.");
    }
  };

  const createMediaRevision = async () => {
    if (!videoId) return;
    try {
      const terms = video?.pexelsTerms?.slice(0, 3) || ["small business", "office"];
      const res = await axios.post(`/api/v2/videos/${videoId}/revisions/media`, {
        sceneIndex: mediaSceneIndex,
        searchTerms: terms,
        reason: `Scene ${mediaSceneIndex + 1} media replacement`,
      });
      setFeedback(tt("videos.detail.revisionQueued"));
      fetchDetails();
    } catch (err: any) {
      setError(tt("videos.detail.actionFailed"));
    }
  };

  const createCaptionStyleRevision = async () => {
    if (!videoId) return;
    try {
      const res = await axios.post(`/api/v2/videos/${videoId}/revisions/caption-style`, {
        captionProfile,
        reason: `Caption style changed to ${captionProfile}`,
      });
      setFeedback(tt("videos.detail.revisionQueued"));
      fetchDetails();
    } catch (err: any) {
      setError(tt("videos.detail.actionFailed"));
    }
  };

  const markFinal = async (revisionId: string) => {
    if (!videoId) return;
    await axios.post(`/api/v2/videos/${videoId}/revisions/${revisionId}/final`);
    fetchDetails();
  };

  if (loading) return <LoadingState label={tt("videos.detail.loading")} />;

  if (!video && !loading) {
    return (
      <Box sx={{ py: 4 }}>
        <EmptyState
          title={tt("videos.detail.notFound")}
          description={tt("videos.detail.notFoundBody")}
          action={
            <Button variant="contained" onClick={() => navigate("/videos")}>
              {tt("videos.detail.backToLibrary")}
            </Button>
          }
        />
      </Box>
    );
  }

  const title = video?.templateName || video?.originalPrompt?.slice(0, 80) || tt("videos.untitled");

  const previewUrl = video?.previewUrl || `/api/short-video/${videoId}`;
  const downloadUrl = video?.downloadUrl || `/api/videos/${videoId}/download`;
  const authedPreviewUrl = withMediaAccessToken(previewUrl);
  const authedDownloadUrl = withMediaAccessToken(downloadUrl);
  const cost = video?.costEstimate;
  const durableArtifacts = video?.durableArtifacts || [];
  const lastReuse = video?.artifactReuse || {};
  const postJobProviderReport = video ? providerReport(video) : null;

  return (
    <>
      <PageHeader
        title={title}
        eyebrow={tt(video?.creationMode === "prompt" ? "videos.detail.eyebrowPrompt" : "videos.detail.eyebrowTemplate")}
        description={tt("videos.detail.description")}
        actions={
          <>
            <Button onClick={() => navigate("/videos")}>{tt("videos.detail.backToLibrary")}</Button>
            {job && <Button onClick={() => navigate(`/jobs/${job.id}`)}>{tt("videos.openProduction")}</Button>}
            <Button
              variant="contained"
              color="primary"
              startIcon={<SendIcon />}
              onClick={() => setReviewModalOpen(true)}
            >
              {tt("videos.publish")}
            </Button>
            <Button
              component="a"
              href={authedDownloadUrl}
              variant="outlined"
              startIcon={<DownloadIcon />}
            >
              {tt("videos.download")}
            </Button>
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setConfirmDelete(true)}
            >
              {tt("common.delete")}
            </Button>
          </>
        }
      />

      {feedback && <Alert severity="info" sx={{ mb: 2 }}>{feedback}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {video && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={8}>
            <SectionCard title={tt("videos.section.overview")}>
              <video
                controls
                src={authedPreviewUrl}
                style={{
                  width: "100%",
                  aspectRatio: video.aspectRatio === "16:9" ? "16 / 9" : "9 / 16",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  background: "#0f172a",
                  borderRadius: 8,
                }}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2 }}>
                <Button
                  startIcon={<ContentCopyIcon />}
                  onClick={() => copy(previewUrl, tt("videos.detail.copied"))}
                >
                  {tt("videos.detail.copyPreviewLink")}
                </Button>
                <Button
                  startIcon={<ContentCopyIcon />}
                  onClick={() => copy(downloadUrl, tt("videos.detail.copied"))}
                >
                  {tt("videos.detail.copyDownloadLink")}
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SendIcon />}
                  onClick={() => setReviewModalOpen(true)}
                  sx={{ marginInlineStart: "auto" }}
                >
                  {tt("videos.publish")}
                </Button>
              </Stack>
            </SectionCard>

            {/* Publishing & Distribution Section */}
            <SectionCard
              title={tt("videos.detail.publishing")}
              description={tt("videos.detail.publishingDesc")}
              actions={
                <Stack direction="row" spacing={1} alignItems="center">
                  <StatusBadge
                    status={
                      pubStatus?.status === "published"
                        ? "ready"
                        : pubStatus?.status === "partially_published"
                          ? "ready"
                          : pubStatus?.status === "publishing"
                            ? "rendering"
                            : pubStatus?.status === "scheduled"
                              ? "queued"
                              : pubStatus?.status === "failed"
                                ? "failed"
                                : "unknown"
                    }
                    label={
                      pubStatus?.status === "published"
                        ? "Published"
                        : pubStatus?.status === "partially_published"
                          ? "Partially Published"
                          : pubStatus?.status === "publishing"
                            ? "Publishing Now"
                            : pubStatus?.status === "scheduled"
                              ? "Scheduled"
                              : pubStatus?.status === "failed"
                                ? "Failed"
                                : "Not Published"
                    }
                  />
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SendIcon />}
                    onClick={() => setReviewModalOpen(true)}
                  >
                    Publish / Schedule
                  </Button>
                </Stack>
              }
            >
              {pubStatus?.publications && pubStatus.publications.length > 0 ? (
                <Stack spacing={1.5}>
                  {pubStatus.publications.map((pub) => (
                    <Card key={pub.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          {pub.platform === "youtube" && <YouTubeIcon sx={{ color: "#ff0000" }} />}
                          {pub.platform === "tiktok" && <span style={{ fontWeight: 900 }}>TT</span>}
                          {pub.platform === "instagram" && <InstagramIcon sx={{ color: "#e1306c" }} />}
                          {pub.platform === "facebook" && <FacebookIcon sx={{ color: "#1877f2" }} />}
                          {pub.platform === "telegram" && <TelegramIcon sx={{ color: "#229ed9" }} />}
                          {pub.platform === "twitter" && <TwitterIcon sx={{ color: "#1da1f2" }} />}
                          <Box>
                            <Typography variant="body2" fontWeight={800} sx={{ textTransform: "capitalize" }}>
                              {pub.platform}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {pub.publishedAt
                                ? `Published: ${new Date(pub.publishedAt).toLocaleString()}`
                                : pub.scheduledAt
                                  ? `Scheduled for: ${new Date(pub.scheduledAt).toLocaleString()} (${pub.sourceTimezone})`
                                  : `Status: ${pub.status}`}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack direction="row" spacing={1} alignItems="center">
                          <StatusBadge status={pub.status} />
                          {pub.providerUrl && (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={pub.providerUrl}
                              target="_blank"
                              rel="noreferrer"
                              startIcon={<OpenInNewIcon />}
                            >
                              View Post
                            </Button>
                          )}
                          {pub.status === "failed" && (
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              onClick={async () => {
                                await axios.post(`/api/v2/publishing/publications/${pub.id}/retry`);
                                fetchDetails();
                              }}
                            >
                              Retry
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {tt("videos.notPublishedYet")}
                </Typography>
              )}
            </SectionCard>

            {/* Original Prompt */}
            {video.originalPrompt && (
              <SectionCard title={tt("videos.detail.prompt")}>
                <Typography variant="body1" sx={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                  "{video.originalPrompt}"
                </Typography>
              </SectionCard>
            )}

            {/* Narration Lines */}
            {video.narrationLines && video.narrationLines.length > 0 && (
              <SectionCard title={tt("videos.narrationScript")}>
                <Stack spacing={1}>
                  {video.narrationLines.map((line, index) => (
                    <Typography key={`${line}-${index}`}>
                      <strong>{tt("videos.narrationScene", { index: format.number(index + 1) })}:</strong> {line}
                    </Typography>
                  ))}
                </Stack>
              </SectionCard>
            )}

            <SectionCard title={tt("videos.section.revisions")}>
              <Stack spacing={2}>
                <Alert severity="info">{tt("videos.revise.help")}</Alert>
                <Typography variant="caption" color="text.secondary">
                  {tt("videos.revise.reuseSummary", {
                    voice: format.number(durableArtifacts.filter((a: any) => a.type === "voice").length),
                    captions: format.number(durableArtifacts.filter((a: any) => a.type === "captions").length),
                    media: format.number(durableArtifacts.filter((a: any) => a.type === "media").length),
                  })}
                </Typography>
                <TextField
                  label={tt("videos.revise.narrationLabel")}
                  value={revisionText}
                  onChange={(e) => setRevisionText(e.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button variant="contained" startIcon={<RefreshIcon />} onClick={createVoiceRevision}>
                    {tt("videos.revise.regenerateVoice")}
                  </Button>
                  <TextField
                    type="number"
                    size="small"
                    label={tt("videos.revise.sceneNumber")}
                    value={mediaSceneIndex + 1}
                    onChange={(e) => setMediaSceneIndex(Math.max(0, Number(e.target.value || 1) - 1))}
                    sx={{ width: 120 }}
                  />
                  <Button variant="outlined" onClick={createMediaRevision}>
                    {tt("videos.revise.replaceSceneMedia")}
                  </Button>
                  <TextField
                    select
                    size="small"
                    label={tt("videos.revise.captionStyle")}
                    value={captionProfile}
                    onChange={(e) => setCaptionProfile(e.target.value as any)}
                    sx={{ width: 150 }}
                  >
                    {["bold", "clean", "minimal", "none"].map((profile) => (
                      <MenuItem key={profile} value={profile}>{tt(`videos.captionStyle.${profile}`)}</MenuItem>
                    ))}
                  </TextField>
                  <Button variant="outlined" onClick={createCaptionStyleRevision}>
                    {tt("videos.revise.restyleCaptions")}
                  </Button>
                </Stack>
                {(lastReuse.reusedArtifacts?.length || lastReuse.regeneratedArtifacts?.length) && (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <Chip color="success" size="small" label={tt("videos.revise.reused", { count: format.number(lastReuse.reusedArtifacts?.length || 0) })} />
                    <Chip color="warning" size="small" label={tt("videos.revise.regenerated", { count: format.number(lastReuse.regeneratedArtifacts?.length || 0) })} />
                  </Stack>
                )}
                <Divider />
                <Typography variant="subtitle2" fontWeight={800}>{tt("videos.detail.versions")}</Typography>
                {revisions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">{tt("videos.detail.noVersions")}</Typography>
                ) : (
                  revisions.map((revision) => (
                    <Card key={revision.id} variant="outlined" sx={{ p: 1.25, borderRadius: 1 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography variant="body2" fontWeight={800}>
                            {tt("videos.revisionLabel", { n: format.number(revision.revisionNumber) })}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {tt(localizedStatus(revision.status).key)} · {format.dateTime(revision.createdAt)}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                          {revision.outputVideoId && (
                            <Button size="small" onClick={() => navigate(`/video/${revision.outputVideoId}`)}>{tt("common.preview")}</Button>
                          )}
                          <Button size="small" variant={revision.isFinal ? "contained" : "outlined"} onClick={() => markFinal(revision.id)}>
                            {revision.isFinal ? tt("videos.detail.isFinal") : tt("videos.detail.markFinal")}
                          </Button>
                        </Stack>
                      </Stack>
                    </Card>
                  ))
                )}
              </Stack>
            </SectionCard>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Stack spacing={2}>
              {/* The final-quality verdict, in the interface language. A video
                  that only missed a creative bar says so here, and stays fully
                  previewable and downloadable above. */}
              {(video as any).finalQuality && (
                <QualityReviewPanel review={(video as any).finalQuality} />
              )}
              {/* Metadata */}
              <SectionCard title={tt("videos.section.production")}>
                <Stack spacing={1.25}>
                  {job && (
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography color="text.secondary">{tt("videos.sourceProduction")}</Typography>
                      <Button size="small" onClick={() => navigate(`/jobs/${job.id}`)}>
                        {tt("videos.viewProduction")}
                      </Button>
                    </Stack>
                  )}
                  {job?.snapshots?.brand && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">{tt("productions.snapshotBrand")}</Typography>
                      <Typography fontWeight={700}>
                        {job.snapshots.brand.name || "—"}
                        {job.snapshots.brand.revision
                          ? ` · ${tt("productions.revision", { n: job.snapshots.brand.revision })}`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                  {job?.snapshots?.template && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">{tt("productions.snapshotTemplate")}</Typography>
                      <Typography fontWeight={700}>
                        {job.snapshots.template.name || job.snapshots.template.id || "—"}
                        {job.snapshots.template.revision
                          ? ` · ${tt("productions.revision", { n: job.snapshots.template.revision })}`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                  {job?.snapshots?.character && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">{tt("productions.snapshotCharacter")}</Typography>
                      <Typography fontWeight={700}>
                        {job.snapshots.character.name || job.snapshots.character.id || "—"}
                        {job.snapshots.character.revision
                          ? ` · ${tt("productions.revision", { n: job.snapshots.character.revision })}`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.detail.creationMode")}</Typography>
                    <Typography fontWeight={700}>
                      {tt(video.creationMode === "prompt" ? "videos.detail.eyebrowPrompt" : "videos.detail.eyebrowTemplate")}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.language")}</Typography>
                    <Typography fontWeight={700}>
                      {tt(languageLabelKey(video.language))}
                      {dialectLabelKey(video.dialect) ? ` · ${tt(dialectLabelKey(video.dialect)!)}` : ""}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("create.quality.label")}</Typography>
                    <Typography fontWeight={700}>{tt(qualityLabelKey(video.quality))}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.aspect")}</Typography>
                    <Typography fontWeight={700}>{tt(aspectLabelKey(video.aspectRatio))}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.detail.mediaSource")}</Typography>
                    <Typography fontWeight={700}>
                      {tt(mediaStrategyLabelKey((video as any).visualSource || video.visualMode))}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.technicalQuality")}</Typography>
                    {(() => {
                      const score = video.technicalScore ?? video.qualityScore;
                      if (score === undefined) {
                        return (
                          <Typography variant="caption" color="text.secondary">
                            {tt("videos.notAvailableHistorical")}
                          </Typography>
                        );
                      }
                      return (
                        <Chip
                          size="small"
                          color={score >= 90 ? "success" : score >= 70 ? "warning" : "error"}
                          label={`${score} / 100`}
                        />
                      );
                    })()}
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.detail.finalDuration")}</Typography>
                    <Typography fontWeight={700}>{format.duration(video.durationSeconds)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("videos.detail.fileSize")}</Typography>
                    <Typography fontWeight={700}>{format.bytes(video.sizeBytes)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{tt("create.review.voice")}</Typography>
                    <Typography fontWeight={700}>{tt(voiceProviderLabelKey(video.voiceProvider))}</Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary">{tt("videos.detail.cost")}</Typography>
                    <Chip
                      size="small"
                      color={isFreeCost(cost) ? "success" : "warning"}
                      label={videoCostLabel(cost)}
                    />
                  </Stack>
                </Stack>
              </SectionCard>

              {/* V2.5.1: everything below is engineering evidence, not customer
                  copy. It stays in the product because it is how a rejected or
                  reviewable video gets explained rather than guessed at, and it
                  is folded away and marked LTR so an Arabic screen never renders
                  an English label as if it were part of the interface. */}
              <Accordion variant="outlined" sx={{ borderRadius: 2 }} dir="ltr">
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" fontWeight={800} dir="auto">
                    {tt("quality.technicalDetails")}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
              <SectionCard title="Production Details">
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Audio QA</Typography>
                    <Typography fontWeight={700}>{video.audioQa?.pass === false ? "Failed" : video.audioQa?.pass ? "Passed" : "N/A"}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Caption Timing</Typography>
                    <Typography fontWeight={700}>{captionTimingLabel(video)}</Typography>
                  </Stack>
                  {video.captionRenderer && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Caption Renderer</Typography>
                      <Typography fontWeight={700}>
                        {video.captionRenderer === "libass" ? "libass (FFmpeg)" : "Remotion"}
                      </Typography>
                    </Stack>
                  )}
                  {video.captionFont && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Caption Font</Typography>
                      <Typography fontWeight={700}>{video.captionFont}</Typography>
                    </Stack>
                  )}
                  {typeof video.captionQa?.pass === "boolean" && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Caption QA</Typography>
                      <Typography fontWeight={700}>{video.captionQa.pass ? "Passed" : "Issues found"}</Typography>
                    </Stack>
                  )}
                  {typeof video.visualShotCount === "number" && video.visualShotCount > 0 && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Visual Shots</Typography>
                      <Typography fontWeight={700}>{video.visualShotCount}</Typography>
                    </Stack>
                  )}
                  {sourceBreakdown(video) && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Shot Sources</Typography>
                      <Typography fontWeight={700}>{sourceBreakdown(video)}</Typography>
                    </Stack>
                  )}
                  {video.editDecisionList?.averageShotSeconds ? (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Average Shot</Typography>
                      <Typography fontWeight={700}>{video.editDecisionList.averageShotSeconds}s</Typography>
                    </Stack>
                  ) : null}
                  {voiceEvidence(video) && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Voice</Typography>
                      <Typography fontWeight={700}>{voiceEvidence(video)}</Typography>
                    </Stack>
                  )}
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Music Ducking</Typography>
                    <Typography fontWeight={700}>{video.audioQa?.duckingProfile || "N/A"}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Media Diversity</Typography>
                    <Typography fontWeight={700}>{video.qualityScoreV2?.mediaDiversity ?? "Human Review Required"}</Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Caption Preset</Typography>
                    <Typography fontWeight={700}>
                      {labelWith(CAPTION_LABELS, video.captionProfileUsed || video.captionStyle) || "Bold"}
                    </Typography>
                  </Stack>
                  {video.musicTrack && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Music Track</Typography>
                      <Typography fontWeight={600} noWrap sx={{ maxWidth: "60%" }} title={video.musicTrack}>
                        {video.musicTrack.replace(".mp3", "")} {video.musicMood ? `(${video.musicMood})` : ""}
                      </Typography>
                    </Stack>
                  )}
                  {video.motionPresetsUsed && video.motionPresetsUsed.length > 0 && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Motion Presets</Typography>
                      <Typography fontWeight={700}>
                        {labelList(MOTION_LABELS, video.motionPresetsUsed)}
                      </Typography>
                    </Stack>
                  )}
                  {video.transitionPresetsUsed && video.transitionPresetsUsed.length > 0 && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Transitions</Typography>
                      <Typography fontWeight={700}>
                        {labelList(MOTION_LABELS, video.transitionPresetsUsed)}
                      </Typography>
                    </Stack>
                  )}
                  {video.mediaSegmentCount !== undefined && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Media Segments</Typography>
                      <Typography fontWeight={700}>
                        {video.mediaSegmentCount} clips
                      </Typography>
                    </Stack>
                  )}
                </Stack>
              </SectionCard>

              {/* Creative summary. Readable evidence of what the engine chose
                  and why; the raw plan stays in the collapsed technical block. */}
              {video.creativePlan && (
                <SectionCard title={tt("videos.section.creative")}>
                  <Stack spacing={1.25}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Creative Style</Typography>
                      <Typography fontWeight={700} sx={{ textTransform: "capitalize" }}>
                        {String(video.creativePlan.stylePreset || "auto").replace(/_/g, " ")}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Pacing</Typography>
                      <Typography fontWeight={700} sx={{ textTransform: "capitalize" }}>
                        {String(video.creativePlan.pacing || "balanced")}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Animation</Typography>
                      <Typography fontWeight={700} sx={{ textTransform: "capitalize" }}>
                        {String(video.creativePlan.motionIntensity || "balanced")}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Shot Count</Typography>
                      <Typography fontWeight={700}>{video.visualShotCount ?? "N/A"}</Typography>
                    </Stack>
                    {creativeTreatments(video) && (
                      <Stack direction="row" justifyContent="space-between" spacing={2}>
                        <Typography color="text.secondary">Visual Treatments</Typography>
                        <Typography fontWeight={700} sx={{ textAlign: "right" }}>
                          {creativeTreatments(video)}
                        </Typography>
                      </Stack>
                    )}
                    {sourceBreakdown(video) && (
                      <Stack direction="row" justifyContent="space-between">
                        <Typography color="text.secondary">Source Types</Typography>
                        <Typography fontWeight={700}>{sourceBreakdown(video)}</Typography>
                      </Stack>
                    )}
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Brand Used</Typography>
                      <Typography fontWeight={700}>
                        {video.brandStyle?.hasBrand ? "Yes" : "Short Studio defaults"}
                      </Typography>
                    </Stack>
                  </Stack>
                </SectionCard>
              )}

              {/* Creative Quality — distinct from Technical Quality; never merged. */}
              <SectionCard title={tt("videos.creativeQuality")}>
                <Stack spacing={1.25}>
                  {video.creativeScore === undefined && video.creativeGrade === undefined ? (
                    <Typography variant="body2" color="text.secondary">
                      {tt("videos.notAvailableHistorical")}
                    </Typography>
                  ) : (
                    <>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography color="text.secondary">{tt("videos.creativeQuality")}</Typography>
                        <Chip
                          size="small"
                          color={(video.creativeScore ?? 0) >= 90 ? "success" : "info"}
                          label={
                            video.creativeGrade
                              ? `${video.creativeGrade} · ${video.creativeScore ?? "—"} / 100`
                              : `${video.creativeScore} / 100`
                          }
                        />
                      </Stack>
                      {video.creativeDiagnostics &&
                        Object.entries(video.creativeDiagnostics)
                          .filter(([, value]) => typeof value === "number")
                          .map(([key, value]) => (
                            <Stack key={key} direction="row" justifyContent="space-between">
                              <Typography color="text.secondary" sx={{ textTransform: "capitalize" }}>
                                {key.replace(/([A-Z])/g, " $1").replace(/Score$/i, "").trim()}
                              </Typography>
                              <Typography fontWeight={700}>{value}</Typography>
                            </Stack>
                          ))}
                      {video.creativeWarnings && video.creativeWarnings.length > 0 && (
                        <Alert severity="warning" sx={{ fontSize: "0.8rem" }}>
                          {video.creativeWarnings.join(" · ")}
                        </Alert>
                      )}
                    </>
                  )}
                </Stack>
              </SectionCard>

              {/* Brand Kit */}
              <SectionCard title="Brand Profile">
                <Stack spacing={1}>
                  <Typography>Brand Name: {video.brandName || "None"}</Typography>
                  <Typography>Watermark: {video.watermarkText || "None"}</Typography>
                  <Typography>Caption Style: {labelWith(CAPTION_LABELS, video.captionStyle) || "Bold"}</Typography>
                  {video.brandStyle?.sources && (
                    <Typography variant="caption" color="text.secondary">
                      Colours you supplied: {suppliedBrandFields(video) || "none - Short Studio defaults were used"}.
                    </Typography>
                  )}
                </Stack>
              </SectionCard>

              {/* Pexels terms */}
              <SectionCard title="Stock Search Terms">
                <Typography color={video.pexelsTerms?.length ? "text.primary" : "text.secondary"}>
                  {video.pexelsTerms?.length
                    ? video.pexelsTerms.join(", ")
                    : "No stock search terms recorded."}
                </Typography>
              </SectionCard>
                  </Stack>
                </AccordionDetails>
              </Accordion>

              {/* Collapsible advanced plan — sanitized (no paths/tokens). */}
              {((video as any).advancedProductionSpec || video.productionSpec) && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography fontWeight={800}>{tt("productions.advanced")}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, background: "#0f172a", color: "#38bdf8", padding: 10, borderRadius: 6, maxHeight: 320, overflowY: "auto" }}>
                      {JSON.stringify((video as any).advancedProductionSpec || video.productionSpec, null, 2)}
                    </pre>
                  </AccordionDetails>
                </Accordion>
              )}
            </Stack>
          </Grid>
        </Grid>
      )}

      {video && (
        <ReviewPublishModal
          open={reviewModalOpen}
          video={video}
          onClose={() => setReviewModalOpen(false)}
          onSuccess={fetchDetails}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={tt("videos.detail.deleteTitle")}
        description={tt("videos.detail.deleteBody")}
        confirmLabel={tt("common.delete")}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteVideo}
      />
    </>
  );
};

export const VideoDetails: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Video Details Error">
      <VideoDetailsContent />
    </ErrorBoundary>
  );
};

export default VideoDetails;
