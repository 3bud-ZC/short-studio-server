import React, { useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ScheduleIcon from "@mui/icons-material/Schedule";
import type { PublishingPlatform } from "../../pages/v2Types";

const AVAILABLE_PLATFORMS: { id: PublishingPlatform; label: string }[] = [
  { id: "youtube", label: "YouTube Shorts" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram Reels" },
  { id: "facebook", label: "Facebook Reels" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "X / Twitter" },
  { id: "threads", label: "Threads" },
];

interface BatchPublishModalProps {
  open: boolean;
  videoIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

export const BatchPublishModal: React.FC<BatchPublishModalProps> = ({
  open,
  videoIds,
  onClose,
  onSuccess,
}) => {
  const [selectedPlatforms, setSelectedPlatforms] = useState<PublishingPlatform[]>(["youtube"]);
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [scheduleTime, setScheduleTime] = useState("18:00");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [privacy, setPrivacy] = useState<"unlisted" | "private" | "public">("unlisted");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const togglePlatform = (p: PublishingPlatform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p)
        ? prev.length > 1
          ? prev.filter((item) => item !== p)
          : prev
        : [...prev, p],
    );
  };

  const handleBatchSubmit = async () => {
    setLoading(true);
    setFeedback(null);

    let scheduledAtIso: string | undefined;
    if (publishMode === "schedule") {
      const dateObj = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (isNaN(dateObj.getTime())) {
        setFeedback({ type: "error", message: "Invalid schedule date or time." });
        setLoading(false);
        return;
      }
      scheduledAtIso = dateObj.toISOString();
    }

    try {
      const res = await axios.post("/api/v2/publishing/batch", {
        videoIds,
        platforms: selectedPlatforms,
        scheduledAt: scheduledAtIso,
        sourceTimezone: timezone,
        privacy,
        publishNow: publishMode === "now",
      });

      setFeedback({
        type: "success",
        message: `Batch distribution launched! Created ${res.data.count} publications across ${selectedPlatforms.length} platform(s).`,
      });

      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1500);
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err.response?.data?.message || err.message || "Batch publication failed.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Typography variant="h6" fontWeight={800}>
          Batch Distribute {videoIds.length} Videos
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Publish or schedule multiple videos simultaneously across social channels.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {feedback && <Alert severity={feedback.type}>{feedback.message}</Alert>}

          <Box>
            <Typography variant="subtitle2" fontWeight={800} gutterBottom>
              Select Target Platforms
            </Typography>
            <Grid container spacing={1}>
              {AVAILABLE_PLATFORMS.map((p) => (
                <Grid item xs={6} key={p.id}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedPlatforms.includes(p.id)}
                        onChange={() => togglePlatform(p.id)}
                      />
                    }
                    label={<Typography variant="body2">{p.label}</Typography>}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" fontWeight={800} gutterBottom>
              Timing
            </Typography>
            <RadioGroup
              row
              value={publishMode}
              onChange={(e) => setPublishMode(e.target.value as any)}
            >
              <FormControlLabel value="now" control={<Radio size="small" />} label="Publish Now" />
              <FormControlLabel value="schedule" control={<Radio size="small" />} label="Schedule Later" />
            </RadioGroup>

            {publishMode === "schedule" && (
              <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
                <TextField
                  label="Date"
                  type="date"
                  size="small"
                  fullWidth
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Time"
                  type="time"
                  size="small"
                  fullWidth
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>
            )}
          </Box>

          <FormControl size="small" fullWidth>
            <InputLabel>Default Privacy</InputLabel>
            <Select
              label="Default Privacy"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as any)}
            >
              <MenuItem value="unlisted">Unlisted (Safe Recommended)</MenuItem>
              <MenuItem value="private">Private</MenuItem>
              <MenuItem value="public">Public</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={
            loading ? (
              <CircularProgress size={18} color="inherit" />
            ) : publishMode === "schedule" ? (
              <ScheduleIcon />
            ) : (
              <SendIcon />
            )
          }
          disabled={loading || selectedPlatforms.length === 0}
          onClick={handleBatchSubmit}
        >
          {loading
            ? "Processing..."
            : publishMode === "schedule"
              ? `Schedule ${videoIds.length} Videos`
              : `Publish ${videoIds.length} Videos Now`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
