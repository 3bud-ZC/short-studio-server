import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";

import { useI18n } from "../i18n";

/**
 * SETTINGS -> PUBLIC ADDRESS
 *
 * The one place an installation's address is configured. A workstation install
 * serves http://localhost:3130; a server install serves the customer's own
 * domain. Every OAuth callback URL is derived from this value, so moving an
 * installation onto a domain is a form field rather than a source edit.
 */

interface PublicUrlState {
  url: string;
  source: "configured" | "environment" | "default";
  isLocal: boolean;
  isSecure: boolean;
  warnings: string[];
  callbackUrls: Record<string, string>;
  trustedProxy: { enabled: boolean; description: string };
}

const PROVIDER_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
};

const SOURCE_KEYS: Record<PublicUrlState["source"], string> = {
  configured: "settings.publicAddress.sourceConfigured",
  environment: "settings.publicAddress.sourceEnvironment",
  default: "settings.publicAddress.sourceDefault",
};

const PublicAddressPanel: React.FC = () => {
  const { t: tr } = useI18n();
  const [state, setState] = useState<PublicUrlState | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providerLabel = (provider: string) =>
    provider === "meta" ? tr("settings.publicAddress.metaLabel") : PROVIDER_LABELS[provider] || provider;

  const load = async () => {
    try {
      const response = await axios.get("/api/v2/system/public-url");
      setState(response.data);
      setDraft(response.data.url || "");
    } catch {
      setError(tr("settings.publicAddress.readFailed"));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Saved through the ordinary settings endpoint, so it is validated with
      // every other setting rather than through a second, looser path.
      await axios.put("/api/v2/settings", { canonicalPublicUrl: draft.trim() });
      await load();
      setMessage(tr("settings.publicAddress.saved"));
    } catch (err: any) {
      setError(err?.response?.data?.error || tr("settings.publicAddress.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const copy = (value: string) => {
    navigator.clipboard?.writeText(value).catch(() => undefined);
  };

  if (!state) {
    return error ? <Alert severity="warning">{error}</Alert> : null;
  }

  return (
    <Stack spacing={2}>
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Grid container spacing={1.5} alignItems="flex-start">
        <Grid item xs={12} md={8}>
          <TextField
            fullWidth
            label={tr("settings.publicAddress.field")}
            placeholder="https://shorts.example.com"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            helperText={tr("settings.publicAddress.currently", { source: tr(SOURCE_KEYS[state.source]) })}
            inputProps={{ dir: "ltr" }}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Button
            fullWidth
            variant="contained"
            disabled={saving || !draft.trim() || draft.trim() === state.url}
            onClick={save}
            sx={{ height: 56 }}
          >
            {saving ? tr("common.saving") : tr("settings.publicAddress.save")}
          </Button>
        </Grid>
      </Grid>

      {state.isLocal && (
        <Alert severity="info">{tr("settings.publicAddress.warningLocal")}</Alert>
      )}
      {!state.isLocal && !state.isSecure && (
        <Alert severity="info">{tr("settings.publicAddress.warningInsecure")}</Alert>
      )}

      <Box>
        <Typography variant="subtitle2" fontWeight={800} gutterBottom>
          {tr("settings.publicAddress.callbacksTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {tr("settings.publicAddress.callbacksBody")}
        </Typography>
        <Stack spacing={1}>
          {Object.entries(state.callbackUrls).map(([provider, url]) => (
            <Box
              key={provider}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                p: 1.25,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700}>
                  {providerLabel(provider)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  dir="ltr"
                  sx={{ display: "block", wordBreak: "break-all", textAlign: "start" }}
                >
                  {url}
                </Typography>
              </Box>
              <Tooltip title={tr("settings.publicAddress.copy")}>
                <IconButton
                  size="small"
                  onClick={() => copy(url)}
                  aria-label={tr("settings.publicAddress.copyAria", { provider: providerLabel(provider) })}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Stack>
      </Box>

      <Typography variant="caption" color="text.secondary">
        {tr("settings.publicAddress.reverseProxy", {
          description: tr(
            state.trustedProxy.enabled
              ? "settings.publicAddress.proxyTrusted"
              : "settings.publicAddress.proxyUntrusted",
          ),
        })}
      </Typography>
    </Stack>
  );
};

export default PublicAddressPanel;
