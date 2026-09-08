import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DownloadIcon from "@mui/icons-material/Download";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SendIcon from "@mui/icons-material/Send";
import YouTubeIcon from "@mui/icons-material/YouTube";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TwitterIcon from "@mui/icons-material/Twitter";
import type {
  PlatformCapabilities,
  PlatformMetadata,
  PublishingPlatform,
  SocialAccount,
  VideoItem,
} from "../../pages/v2Types";
import { withMediaAccessToken } from "../../utils/auth";

const AVAILABLE_PLATFORMS: { id: PublishingPlatform; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "youtube", label: "YouTube Shorts", icon: <YouTubeIcon />, color: "#ff0000" },
  { id: "tiktok", label: "TikTok", icon: <span style={{ fontWeight: 900 }}>TT</span>, color: "#000000" },
  { id: "instagram", label: "Instagram Reels", icon: <InstagramIcon />, color: "#e1306c" },
  { id: "facebook", label: "Facebook Reels", icon: <FacebookIcon />, color: "#1877f2" },
  { id: "linkedin", label: "LinkedIn", icon: <SendIcon />, color: "#0a66c2" },
  { id: "twitter", label: "X / Twitter", icon: <TwitterIcon />, color: "#1da1f2" },
  { id: "threads", label: "Threads", icon: <SendIcon />, color: "#000000" },
];

const TIMEZONES = [
  "Africa/Cairo",
  "UTC",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
];

const PROVIDER_LABEL: Record<string, string> = {
  youtube_direct: "YouTube",
  meta_direct: "Meta",
  tiktok_direct: "TikTok",
  telegram_bot: "Telegram Bot",
  upload_post: "Upload-Post",
};

interface ReviewPublishModalProps {
  open: boolean;
  video: VideoItem;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ReviewPublishModal: React.FC<ReviewPublishModalProps> = ({
  open,
  video,
  onClose,
  onSuccess,
}) => {
  const [selectedPlatforms, setSelectedPlatforms] = useState<PublishingPlatform[]>(["youtube"]);
  const [activeTab, setActiveTab] = useState<PublishingPlatform>("youtube");
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");

  // Scheduling State
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [scheduleTime, setScheduleTime] = useState("18:00");
  const [timezone, setTimezone] = useState("Africa/Cairo");

  // Accounts
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Record<string, string>>({});

  // Metadata per platform
  const [metadataMap, setMetadataMap] = useState<Record<string, PlatformMetadata>>({});
  const [generatingAi, setGeneratingAi] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  // Load connected accounts
  useEffect(() => {
    if (!open) return;
    axios.get("/api/v2/publishing/accounts").then((res) => {
      const accList: SocialAccount[] = res.data.accounts || [];
      setAccounts(accList);

      const mapping: Record<string, string> = {};
      for (const acc of accList) {
        if (!mapping[acc.platform] && acc.connectionStatus === "connected") {
          mapping[acc.platform] = acc.id;
        }
      }
      setSelectedAccountIds(mapping);
    }).catch(() => {});

    // Initial default metadata
    const initialMeta: Record<string, PlatformMetadata> = {};
    for (const p of AVAILABLE_PLATFORMS) {
      initialMeta[p.id] = {
        title: video.templateName || video.originalPrompt?.slice(0, 70) || "Viral Short",
        caption: video.originalPrompt || video.narrationLines?.join(" ") || "",
        description: video.originalPrompt || video.narrationLines?.join("\n") || "",
        hashtags: ["Shorts", "Viral", (video.brandName || "Brand").replace(/\s+/g, "")],
        tags: ["Shorts", "Viral", video.brandName || "Brand"],
        privacy: "unlisted",
        reelSettings: { shareToFeed: true },
      };
    }
    setMetadataMap(initialMeta);
  }, [open, video]);

  // Validate format when active platform changes
  useEffect(() => {
    if (!open || !activeTab) return;
    axios
      .post("/api/v2/publishing/validate-video", {
        videoId: video.videoId,
        platform: activeTab,
      })
      .then((res) => {
        const warnings = res.data?.warnings || [];
        const errors = res.data?.errors || [];
        setValidationWarnings([...errors, ...warnings]);
      })
      .catch(() => setValidationWarnings([]));
  }, [open, activeTab, video.videoId]);

  const togglePlatform = (platform: PublishingPlatform) => {
    setSelectedPlatforms((prev) => {
      const exists = prev.includes(platform);
      if (exists) {
        if (prev.length === 1) return prev; // keep at least one
        const updated = prev.filter((p) => p !== platform);
        if (activeTab === platform) setActiveTab(updated[0]);
        return updated;
      }
      const updated = [...prev, platform];
      setActiveTab(platform);
      return updated;
    });
  };

  const handleAiOptimize = async (platform: PublishingPlatform) => {
    setGeneratingAi(true);
    try {
      const res = await axios.post("/api/v2/publishing/metadata/generate", {
        videoId: video.videoId,
        prompt: video.originalPrompt,
        title: video.templateName || video.templateId,
        narrationLines: video.narrationLines,
        brandName: video.brandName,
        platform,
        language: video.language,
      });

      if (res.data?.metadata) {
        setMetadataMap((prev) => ({
          ...prev,
          [platform]: {
            ...prev[platform],
            ...res.data.metadata,
          },
        }));
        setFeedback({ type: "success", message: `AI optimized metadata for ${platform.toUpperCase()}!` });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: "Failed to generate AI metadata." });
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleAiOptimizeAll = async () => {
    setGeneratingAi(true);
    try {
      const updates = await Promise.all(
        selectedPlatforms.map(async (platform) => {
          const res = await axios.post("/api/v2/publishing/metadata/generate", {
            videoId: video.videoId,
            prompt: video.originalPrompt,
            title: video.templateName || video.templateId,
            narrationLines: video.narrationLines,
            brandName: video.brandName,
            platform,
            language: video.language,
          });
          return { platform, metadata: res.data.metadata };
        }),
      );

      setMetadataMap((prev) => {
        const next = { ...prev };
        for (const u of updates) {
          if (u.metadata) {
            next[u.platform] = { ...next[u.platform], ...u.metadata };
          }
        }
        return next;
      });
      setFeedback({ type: "success", message: "AI optimized metadata across all chosen platforms!" });
    } catch {
      setFeedback({ type: "error", message: "Failed to generate metadata across all platforms." });
    } finally {
      setGeneratingAi(false);
    }
  };

  const handlePublishOrSchedule = async () => {
    setSubmitting(true);
    setFeedback(null);

    let scheduledAtIso: string | undefined;
    if (publishMode === "schedule") {
      const dateTimeStr = `${scheduleDate}T${scheduleTime}:00`;
      const dateObj = new Date(dateTimeStr);
      if (isNaN(dateObj.getTime())) {
        setFeedback({ type: "error", message: "Invalid schedule date or time." });
        setSubmitting(false);
        return;
      }
      scheduledAtIso = dateObj.toISOString();
    }

    try {
      const results = await Promise.all(
        selectedPlatforms.map((platform) => {
          const meta = metadataMap[platform] || {};
          return axios.post("/api/v2/publishing/publications", {
            videoId: video.videoId,
            platform,
            accountId: selectedAccountIds[platform],
            title: meta.title,
            caption: meta.caption,
            description: meta.description,
            hashtags: meta.hashtags || [],
            metadata: meta,
            scheduledAt: scheduledAtIso,
            sourceTimezone: timezone,
            publishNow: publishMode === "now",
            idempotencyKey: `pub_${video.videoId}_${platform}_${Date.now()}`,
          });
        }),
      );

      setFeedback({
        type: "success",
        message:
          publishMode === "now"
            ? `Launched publication to ${results.length} platform(s)!`
            : `Scheduled publication to ${results.length} platform(s) for ${scheduleDate} ${scheduleTime} (${timezone}).`,
      });

      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1400);
    } catch (error: any) {
      setFeedback({
        type: "error",
        message: error.response?.data?.message || error.message || "Publication submission failed.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const currentMeta = metadataMap[activeTab] || {};

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Review & Distribute Video
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Video ID: {video.videoId} · Duration: {video.durationSeconds || video.requestedDurationSeconds || 30}s
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            disabled={generatingAi}
            onClick={handleAiOptimizeAll}
          >
            {generatingAi ? "AI Optimizing..." : "AI Optimize All Platforms"}
          </Button>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {feedback && (
          <Alert severity={feedback.type} sx={{ mb: 2 }}>
            {feedback.message}
          </Alert>
        )}

        {validationWarnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {validationWarnings.join(" | ")}
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* Left Column: Video Preview & Mode */}
          <Grid item xs={12} md={4}>
            <Stack spacing={2}>
              <Card variant="outlined" sx={{ p: 1, bgcolor: "#0f172a", borderRadius: 2 }}>
                <video
                  controls
                  src={withMediaAccessToken(video.previewUrl || `/api/short-video/${video.videoId}`)}
                  style={{
                    width: "100%",
                    maxHeight: 280,
                    borderRadius: 6,
                    objectFit: "contain",
                    background: "#000",
                  }}
                />
              </Card>

              {/* Distribution Timing Choice */}
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                  Distribution Timing
                </Typography>
                <RadioGroup
                  value={publishMode}
                  onChange={(e) => setPublishMode(e.target.value as any)}
                >
                  <FormControlLabel
                    value="now"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2" fontWeight={700}>
                          Publish Now
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Upload immediately to selected platforms
                        </Typography>
                      </Box>
                    }
                  />
                  <FormControlLabel
                    value="schedule"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2" fontWeight={700}>
                          Schedule for Later
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Post automatically at exact local date & time
                        </Typography>
                      </Box>
                    }
                  />
                </RadioGroup>

                {publishMode === "schedule" && (
                  <Stack spacing={1.5} sx={{ mt: 2, pt: 1.5, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                    <TextField
                      label="Date"
                      type="date"
                      size="small"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      label="Time"
                      type="time"
                      size="small"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                    <FormControl size="small" fullWidth>
                      <InputLabel>Timezone</InputLabel>
                      <Select
                        label="Timezone"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                      >
                        {TIMEZONES.map((tz) => (
                          <MenuItem key={tz} value={tz}>
                            {tz}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                )}
              </Card>

              {/* Platform Selector Chips */}
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                  Target Channels ({selectedPlatforms.length})
                </Typography>
                <Stack spacing={1}>
                  {AVAILABLE_PLATFORMS.map((p) => {
                    const isSelected = selectedPlatforms.includes(p.id);
                    const connected = accounts.some(
                      (a) => a.platform === p.id && a.connectionStatus === "connected",
                    );

                    return (
                      <Stack
                        key={p.id}
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{
                          p: 1,
                          borderRadius: 1,
                          bgcolor: isSelected ? "action.selected" : "background.paper",
                          border: "1px solid",
                          borderColor: isSelected ? "primary.main" : "divider",
                          cursor: "pointer",
                        }}
                        onClick={() => togglePlatform(p.id)}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Checkbox size="small" checked={isSelected} sx={{ p: 0 }} />
                          <Typography variant="body2" fontWeight={600}>
                            {p.label}
                          </Typography>
                        </Stack>
                        <Chip
                          size="small"
                          label={connected ? "Connected" : "Auto route"}
                          color={connected ? "success" : "default"}
                          sx={{ fontSize: 10, height: 20 }}
                        />
                      </Stack>
                    );
                  })}
                </Stack>
              </Card>
            </Stack>
          </Grid>

          {/* Right Column: Platform Metadata Editor */}
          <Grid item xs={12} md={8}>
            <Tabs
              value={activeTab}
              onChange={(_, val) => setActiveTab(val)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
            >
              {selectedPlatforms.map((pId) => {
                const pInfo = AVAILABLE_PLATFORMS.find((p) => p.id === pId);
                return <Tab key={pId} value={pId} label={pInfo?.label || pId} icon={pInfo?.icon as any} iconPosition="start" />;
              })}
            </Tabs>

            <Stack spacing={2}>
              {/* Account Selector for this platform */}
              <Stack direction="row" spacing={2} alignItems="center">
                <FormControl size="small" fullWidth>
                  <InputLabel>Publishing Account</InputLabel>
                  <Select
                    label="Publishing Account"
                    value={selectedAccountIds[activeTab] || ""}
                    onChange={(e) =>
                      setSelectedAccountIds((prev) => ({
                        ...prev,
                        [activeTab]: e.target.value,
                      }))
                    }
                  >
                    <MenuItem value="">Default / Auto Provider Account</MenuItem>
                    {accounts
                      .filter((a) => a.platform === activeTab)
                      .map((acc) => (
                        <MenuItem key={acc.id} value={acc.id}>
                          {acc.accountName} ({PROVIDER_LABEL[acc.provider] || acc.provider})
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AutoAwesomeIcon />}
                  disabled={generatingAi}
                  onClick={() => handleAiOptimize(activeTab)}
                  sx={{ minWidth: 160 }}
                >
                  AI Optimize {activeTab.toUpperCase()}
                </Button>
              </Stack>

              {/* YouTube specific */}
              {activeTab === "youtube" && (
                <>
                  <TextField
                    label="YouTube Title (max 100 chars)"
                    size="small"
                    fullWidth
                    value={currentMeta.title || ""}
                    onChange={(e) =>
                      setMetadataMap((prev) => ({
                        ...prev,
                        youtube: { ...prev.youtube, title: e.target.value },
                      }))
                    }
                  />
                  <TextField
                    label="YouTube Description"
                    size="small"
                    multiline
                    rows={4}
                    fullWidth
                    value={currentMeta.description || ""}
                    onChange={(e) =>
                      setMetadataMap((prev) => ({
                        ...prev,
                        youtube: { ...prev.youtube, description: e.target.value },
                      }))
                    }
                  />
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <FormControl size="small" fullWidth>
                        <InputLabel>Privacy</InputLabel>
                        <Select
                          label="Privacy"
                          value={currentMeta.privacy || "unlisted"}
                          onChange={(e) =>
                            setMetadataMap((prev) => ({
                              ...prev,
                              youtube: { ...prev.youtube, privacy: e.target.value as any },
                            }))
                          }
                        >
                          <MenuItem value="unlisted">Unlisted (Safe Recommended)</MenuItem>
                          <MenuItem value="private">Private</MenuItem>
                          <MenuItem value="public">Public</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        label="Tags (comma separated)"
                        size="small"
                        fullWidth
                        value={currentMeta.tags?.join(", ") || ""}
                        onChange={(e) =>
                          setMetadataMap((prev) => ({
                            ...prev,
                            youtube: {
                              ...prev.youtube,
                              tags: e.target.value.split(",").map((s) => s.trim()),
                            },
                          }))
                        }
                      />
                    </Grid>
                  </Grid>
                </>
              )}

              {/* TikTok specific */}
              {activeTab === "tiktok" && (
                <>
                  <TextField
                    label="TikTok Caption (Hook & Call to action)"
                    size="small"
                    multiline
                    rows={4}
                    fullWidth
                    value={currentMeta.caption || ""}
                    onChange={(e) =>
                      setMetadataMap((prev) => ({
                        ...prev,
                        tiktok: { ...prev.tiktok, caption: e.target.value },
                      }))
                    }
                  />
                  <TextField
                    label="Hashtags (space separated, e.g. #fyp #viral)"
                    size="small"
                    fullWidth
                    value={currentMeta.hashtags?.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ") || ""}
                    onChange={(e) =>
                      setMetadataMap((prev) => ({
                        ...prev,
                        tiktok: {
                          ...prev.tiktok,
                          hashtags: e.target.value
                            .split(" ")
                            .map((s) => s.replace("#", "").trim())
                            .filter(Boolean),
                        },
                      }))
                    }
                  />
                </>
              )}

              {/* Instagram specific */}
              {activeTab === "instagram" && (
                <>
                  <TextField
                    label="Instagram Reel Caption"
                    size="small"
                    multiline
                    rows={5}
                    fullWidth
                    value={currentMeta.caption || ""}
                    onChange={(e) =>
                      setMetadataMap((prev) => ({
                        ...prev,
                        instagram: { ...prev.instagram, caption: e.target.value },
                      }))
                    }
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={currentMeta.reelSettings?.shareToFeed ?? true}
                        onChange={(e) =>
                          setMetadataMap((prev) => ({
                            ...prev,
                            instagram: {
                              ...prev.instagram,
                              reelSettings: { shareToFeed: e.target.checked },
                            },
                          }))
                        }
                      />
                    }
                    label="Share Reel to Main Instagram Profile Feed"
                  />
                </>
              )}

              {/* Facebook specific */}
              {activeTab === "facebook" && (
                <>
                  <TextField
                    label="Facebook Post Description"
                    size="small"
                    multiline
                    rows={4}
                    fullWidth
                    value={currentMeta.description || ""}
                    onChange={(e) =>
                      setMetadataMap((prev) => ({
                        ...prev,
                        facebook: { ...prev.facebook, description: e.target.value },
                      }))
                    }
                  />
                </>
              )}

              {/* X / Twitter */}
              {activeTab === "twitter" && (
                <TextField
                  label="Tweet Text (max 280 chars)"
                  size="small"
                  multiline
                  rows={3}
                  fullWidth
                  value={currentMeta.caption || ""}
                  onChange={(e) =>
                    setMetadataMap((prev) => ({
                      ...prev,
                      twitter: { ...prev.twitter, caption: e.target.value },
                    }))
                  }
                />
              )}
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          component="a"
          href={withMediaAccessToken(video.downloadUrl || `/api/videos/${video.videoId}/download`)}
          startIcon={<DownloadIcon />}
          sx={{ mr: "auto" }}
        >
          Download MP4
        </Button>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          size="large"
          startIcon={
            submitting ? (
              <CircularProgress size={18} color="inherit" />
            ) : publishMode === "schedule" ? (
              <ScheduleIcon />
            ) : (
              <SendIcon />
            )
          }
          disabled={submitting || selectedPlatforms.length === 0}
          onClick={handlePublishOrSchedule}
        >
          {submitting
            ? "Submitting..."
            : publishMode === "schedule"
              ? `Schedule to ${selectedPlatforms.length} Platform(s)`
              : `Publish to ${selectedPlatforms.length} Platform(s) Now`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
