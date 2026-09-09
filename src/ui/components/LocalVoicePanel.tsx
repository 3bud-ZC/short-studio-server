/**
 * LOCAL VOICE (V2.5.1)
 * --------------------
 * Arabic narration is produced on this machine by default - VoiceTut for high
 * quality, KemeTone for lower-end hardware. When neither is installed the
 * engine refuses the job with `local_voice_setup_required` and Create Video
 * tells the customer to "Set up local voice"... which, until this panel, led
 * nowhere: `/api/v2/providers/local-voice/status` existed and nothing in the
 * interface ever called it.
 *
 * This is that surface. It reports what is actually installed, re-verifies on
 * demand, and never claims a voice is ready on the strength of a settings row -
 * the state comes from the model manager's own record.
 */

import React from "react";
import axios from "axios";
import { Alert, Button, Chip, Stack, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

import { StatusBadge } from "./v2";
import { useI18n } from "../i18n";

type LocalVoiceRecord = {
  modelId: "voicetut" | "kemetone";
  state: string;
  installedAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
};

const LABEL_KEY: Record<string, string> = {
  voicetut: "integrations.catalog.voicetut.label",
  kemetone: "integrations.catalog.kemetone.label",
};

const HINT_KEY: Record<string, string> = {
  voicetut: "create.voice.voicetutHint",
  kemetone: "create.voice.kemetoneHint",
};

export function LocalVoicePanel() {
  const { t, format } = useI18n();
  const [models, setModels] = React.useState<LocalVoiceRecord[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const response = await axios.get("/api/v2/providers/local-voice/status");
      setModels(response.data.models || []);
      setError(null);
    } catch {
      setModels([]);
      setError(t("settings.localVoice.loadFailed"));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function verify(modelId: string) {
    setBusy(modelId);
    try {
      await axios.post("/api/v2/providers/local-voice/install", { modelId });
      await load();
    } catch {
      setError(t("settings.localVoice.verifyFailed"));
    } finally {
      setBusy(null);
    }
  }

  const ready = (models || []).some(
    (model) => model.state === "ready" || model.state === "healthy",
  );

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t("settings.localVoice.description")}
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}
      {models !== null && !ready && !error && (
        <Alert severity="info">{t("settings.localVoice.noneInstalled")}</Alert>
      )}

      {(models || []).map((model) => (
        <Stack
          key={model.modelId}
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
          sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25 }}
        >
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle2">{t(LABEL_KEY[model.modelId] || "common.unknown")}</Typography>
              <StatusBadge status={model.state} />
              <Chip size="small" variant="outlined" label={t("create.voice.free")} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t(HINT_KEY[model.modelId] || "common.notAvailable")}
            </Typography>
            {model.lastVerifiedAt && (
              <Typography variant="caption" color="text.secondary">
                {t("settings.localVoice.lastChecked", { when: format.dateTime(model.lastVerifiedAt) })}
              </Typography>
            )}
          </Stack>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={busy === model.modelId}
            onClick={() => verify(model.modelId)}
          >
            {busy === model.modelId ? t("common.refreshing") : t("settings.localVoice.check")}
          </Button>
        </Stack>
      ))}
    </Stack>
  );
}
