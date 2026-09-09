import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type { ApiTokenItem, ProviderItem } from "./v2Types";
import { useI18n } from "../i18n";
import { localizedStatus } from "../i18n/status";

type DiscoveredVoice = {
  id: string;
  name: string;
  language?: string;
  dialect?: string;
  gender?: string;
  category?: string;
  accent?: string;
  previewUrl?: string;
};

type VoiceLabConfig = {
  configured: boolean;
  model: string;
  referenceScript: string;
  maxCharacters: number;
  presets: Array<{ id: string; settings: Record<string, unknown> }>;
  note: string;
  defaultArabicVoice?: { voiceId: string; voiceName?: string; preset?: string; selectedAt?: string } | null;
  defaultArabicVoiceConfigured?: boolean;
  defaultArabicVoiceAvailable?: boolean;
  defaultArabicVoiceName?: string;
  arabicProductionReady?: boolean;
  setupRequiredReason?: string;
  previewSynthesisAllowed?: boolean;
};

/** Backend provider category → i18n key stems (heading + description). */
const CATEGORY_KEY: Record<string, { label: string; desc: string }> = {
  "Content AI": { label: "providers.category.contentAi", desc: "providers.categoryDesc.contentAi" },
  Visuals: { label: "providers.category.visuals", desc: "providers.categoryDesc.visuals" },
  Voice: { label: "providers.category.voice", desc: "providers.categoryDesc.voice" },
  Captions: { label: "providers.category.captions", desc: "providers.categoryDesc.captions" },
  Renderer: { label: "providers.category.renderer", desc: "providers.categoryDesc.default" },
  Motion: { label: "providers.category.motion", desc: "providers.categoryDesc.default" },
  "Post Production": { label: "providers.category.postProduction", desc: "providers.categoryDesc.default" },
  "AI GPU": { label: "providers.category.aiGpu", desc: "providers.categoryDesc.default" },
  Publishing: { label: "providers.category.publishing", desc: "providers.categoryDesc.default" },
  Infrastructure: { label: "providers.category.infrastructure", desc: "providers.categoryDesc.default" },
};

const ProvidersPage: React.FC = () => {
  const { t: tr, format } = useI18n();
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [validatingProvider, setValidatingProvider] = useState<string | null>(null);
  const [validationAlert, setValidationAlert] = useState<{ provider: string; message: string; healthy: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentialProvider, setCredentialProvider] = useState<ProviderItem | null>(null);
  const [credentialType, setCredentialType] = useState("api_key");
  const [credentialValue, setCredentialValue] = useState("");
  const [savingCredential, setSavingCredential] = useState(false);

  // Voice Lab / voice discovery state (ElevenLabs only).
  const [voiceLabOpen, setVoiceLabOpen] = useState(false);
  const [voiceLabConfig, setVoiceLabConfig] = useState<VoiceLabConfig | null>(null);
  const [voiceLabVoices, setVoiceLabVoices] = useState<DiscoveredVoice[]>([]);
  const [voiceLabLoading, setVoiceLabLoading] = useState(false);
  const [voiceLabError, setVoiceLabError] = useState<string | null>(null);
  const [voiceLabText, setVoiceLabText] = useState("");
  const [voiceLabVoiceId, setVoiceLabVoiceId] = useState("");
  const [voiceLabPreset, setVoiceLabPreset] = useState("natural");
  const [voiceLabLanguage, setVoiceLabLanguage] = useState("ar");
  const [voiceLabDialect, setVoiceLabDialect] = useState("egyptian");
  const [voiceLabAudio, setVoiceLabAudio] = useState<string | null>(null);
  const [voiceLabGenerating, setVoiceLabGenerating] = useState(false);
  const [defaultArabicVoiceId, setDefaultArabicVoiceId] = useState("");
  const [browseOnly, setBrowseOnly] = useState(false);
  const [voiceLabSearch, setVoiceLabSearch] = useState("");

  const categoryLabel = (category: string) =>
    CATEGORY_KEY[category] ? tr(CATEGORY_KEY[category].label) : category;
  const categoryDescription = (category: string) =>
    tr(CATEGORY_KEY[category]?.desc || "providers.categoryDesc.default");

  const billingLabel = (value?: string) => {
    switch (value) {
      case "LOCAL_FREE":
        return "Local / Free";
      case "FREE_API":
        return "Free API";
      case "FREE_TIER":
        return "Free Tier";
      case "USAGE_BASED":
        return "Usage Based";
      case "SUBSCRIPTION":
        return "Subscription";
      default:
        return "Unknown Cost";
    }
  };

  const credentialTypeLabel = (type: string) => {
    if (type === "api_key") return "API key";
    if (type === "service_account_json") return "Service account";
    if (type === "bot_token") return "Bot token";
    if (type === "chat_config") return "Chat settings";
    if (type === "oauth_token") return "Account connection";
    if (type === "app_config") return "App settings";
    return type.replaceAll("_", " ");
  };

  /**
   * The provider description line. The `/api/v2/providers` endpoint emits raw
   * developer strings here (env-var names, "GEMINI_API_KEY is not configured"),
   * which must never reach a customer screen. We derive a localised line from
   * the status the same endpoint reports instead.
   */
  const providerDescription = (provider: ProviderItem): string => {
    if (provider.canonical?.customerStatus) {
      if (provider.canonical.customerStatus === "Built In") return tr("providers.msg.builtIn");
      if (provider.canonical.customerStatus === "Ready") return tr("providers.msg.connected");
      if (provider.canonical.customerStatus === "Configured") return tr("providers.msg.configured");
      if (provider.canonical.customerStatus === "Temporarily Unavailable") return tr("providers.msg.unavailable");
      if (provider.canonical.customerStatus === "Ready to Connect" || provider.canonical.customerStatus === "Not Configured") {
        return tr("providers.msg.notConfigured");
      }
    }
    const builtIn = ["local_ai", "kokoro", "piper", "whisper_cpp", "remotion", "ffmpeg", "n8n", "postgres"].includes(
      provider.id || "",
    );
    if (builtIn) return tr("providers.msg.builtIn");
    if (provider.configured === false) return tr("providers.msg.notConfigured");
    const status = String(provider.status || "").toLowerCase();
    if (["connected", "live_verified", "verified", "linked"].includes(status)) return tr("providers.msg.connected");
    if (["healthy", "ready", "ok", "operational", "pass", "available"].includes(status)) return tr("providers.msg.healthy");
    if (["unhealthy", "unavailable", "provider_unavailable", "offline", "down", "timeout"].includes(status)) {
      return tr("providers.msg.unavailable");
    }
    if (["not_configured", "unconfigured", "missing", "disabled", "none"].includes(status)) {
      return tr("providers.msg.notConfigured");
    }
    if (["configured"].includes(status)) return tr("providers.msg.configured");
    return tr("providers.msg.needsAttention");
  };

  const load = async () => {
    try {
      const response = await axios.get("/api/v2/providers");
      setProviders(response.data.providers || []);
      setCategories(response.data.categories || []);
      setError(null);
    } catch {
      setError(tr("providers.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ProviderItem[]>();
    for (const category of categories) map.set(category, []);
    for (const provider of providers) {
      const list = map.get(provider.category) || [];
      list.push(provider);
      map.set(provider.category, list);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [providers, categories]);

  const testProviderConnection = async (provider: ProviderItem) => {
    const providerName = provider.name;
    setValidatingProvider(providerName);
    setValidationAlert(null);
    try {
      const slug = provider.id || providerName.toLowerCase().split(" ")[0].replace(/[^a-z]/g, "");
      const response = await axios.post(`/api/v2/providers/${slug}/validate`);
      setValidationAlert({
        provider: providerName,
        message: response.data.message || tr("providers.testSucceeded"),
        healthy: response.data.healthy ?? (response.data.status === "healthy"),
      });
      await load();
    } catch (err: any) {
      setValidationAlert({
        provider: providerName,
        message: err?.response?.data?.message || tr("providers.testCallFailed"),
        healthy: false,
      });
    } finally {
      setValidatingProvider(null);
    }
  };

  /**
   * Voice Lab lets the human audition ElevenLabs voices before any video is
   * rendered. The engine never picks a "best" or "Egyptian" voice for them.
   */
  const openVoiceLab = async (options: { browseOnly?: boolean } = {}) => {
    setBrowseOnly(Boolean(options.browseOnly));
    setVoiceLabOpen(true);
    setVoiceLabError(null);
    setVoiceLabAudio(null);
    setVoiceLabLoading(true);
    try {
      const [configResponse, voicesResponse] = await Promise.all([
        axios.get("/api/v2/voice-lab/config"),
        axios.get("/api/v2/providers/elevenlabs/voices", { params: { language: "ar" } }),
      ]);
      const config: VoiceLabConfig = configResponse.data;
      setVoiceLabConfig(config);
      setDefaultArabicVoiceId(config.defaultArabicVoice?.voiceId || "");
      setVoiceLabVoiceId(config.defaultArabicVoice?.voiceId || "");
      if (!voiceLabText) setVoiceLabText(config.referenceScript || "");
      const voices: DiscoveredVoice[] = voicesResponse.data.voices || [];
      setVoiceLabVoices(voices);
      const warnings: string[] = [
        ...(voicesResponse.data.warnings || []),
        ...(config.setupRequiredReason ? [config.setupRequiredReason] : []),
      ];
      if (warnings.length) setVoiceLabError(warnings.join(" "));
    } catch (err: any) {
      setVoiceLabError(err?.response?.data?.message || tr("providers.voiceLab.loadFailed"));
    } finally {
      setVoiceLabLoading(false);
    }
  };

  /**
   * Persist the voice the human picked. Selection is explicit and manual - the
   * engine never promotes a voice on its own.
   */
  const saveDefaultArabicVoice = async () => {
    if (!voiceLabVoiceId) return;
    try {
      await axios.put("/api/v2/voice-lab/default-voice", {
        voiceId: voiceLabVoiceId,
        voiceName: voiceLabVoices.find((voice) => voice.id === voiceLabVoiceId)?.name,
        preset: voiceLabPreset,
        modelId: voiceLabConfig?.model,
      });
      setDefaultArabicVoiceId(voiceLabVoiceId);
      setVoiceLabError(null);
      await load();
    } catch (err) {
      setVoiceLabError(
        (err as any)?.response?.data?.message || tr("providers.voiceLab.saveDefaultFailed"),
      );
    }
  };

  const generateVoiceLabPreview = async () => {
    setVoiceLabGenerating(true);
    setVoiceLabError(null);
    setVoiceLabAudio(null);
    try {
      const response = await axios.post("/api/v2/voice-lab/preview", {
        text: voiceLabText,
        voiceId: voiceLabVoiceId,
        preset: voiceLabPreset,
        language: voiceLabLanguage,
        dialect: voiceLabDialect,
      });
      setVoiceLabAudio(response.data.audioBase64 || null);
    } catch (err: any) {
      setVoiceLabError(err?.response?.data?.message || tr("providers.voiceLab.previewFailed"));
    } finally {
      setVoiceLabGenerating(false);
    }
  };

  const openCredentialDialog = (provider: ProviderItem) => {
    setCredentialProvider(provider);
    setCredentialType(provider.credentialTypes?.[0] || "api_key");
    setCredentialValue("");
  };

  const saveCredential = async () => {
    if (!credentialProvider?.id) return;
    setSavingCredential(true);
    try {
      await axios.put(`/api/v2/providers/${credentialProvider.id}/credentials`, {
        credentialType,
        value: credentialValue,
      });
      setCredentialProvider(null);
      setCredentialValue("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || tr("providers.credentialSaveFailed"));
    } finally {
      setSavingCredential(false);
    }
  };

  const disconnectProvider = async (provider: ProviderItem) => {
    if (!provider.id) return;
    try {
      await axios.delete(`/api/v2/providers/${provider.id}/credentials`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || tr("providers.disconnectFailed"));
    }
  };

  const filteredVoiceLabVoices = useMemo(() => {
    const needle = voiceLabSearch.trim().toLowerCase();
    if (!needle) return voiceLabVoices;
    return voiceLabVoices.filter((voice) =>
      [voice.name, voice.accent, voice.gender, voice.category, voice.language, voice.dialect]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [voiceLabSearch, voiceLabVoices]);

  if (loading) return <LoadingState label={tr("providers.loading")} />;

  return (
    <>
      <PageHeader
        title={tr("providers.title")}
        eyebrow={tr("providers.eyebrow")}
        description={tr("providers.description")}
        actions={
          <Button startIcon={<RefreshIcon />} onClick={load}>
            {tr("common.refresh")}
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {validationAlert && (
        <Alert
          severity={validationAlert.healthy ? "success" : "warning"}
          sx={{ mb: 2 }}
          onClose={() => setValidationAlert(null)}
        >
          <strong>{validationAlert.provider}:</strong> {validationAlert.message}
        </Alert>
      )}

      <Grid container spacing={2}>
        {grouped.map(([category, items]) => (
          <Grid item xs={12} key={category}>
            <SectionCard title={categoryLabel(category)} description={categoryDescription(category)}>
              <Grid container spacing={2}>
                {items.map((provider) => (
                  <Grid item xs={12} md={6} xl={4} key={provider.name}>
                    <SectionCard>
                      <Stack spacing={1.5}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="h6" fontWeight={800}>{provider.name}</Typography>
                          <StatusBadge status={provider.status} label={provider.canonical?.customerStatus} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {providerDescription(provider)}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          {provider.canonical?.category && (
                            <Chip size="small" variant="outlined" label={provider.canonical.category} />
                          )}
                          {provider.canonical?.billingClass && (
                            <Chip size="small" variant="outlined" label={billingLabel(provider.canonical.billingClass)} />
                          )}
                          {provider.isDefault && (
                            <Chip size="small" color="primary" label={tr("providers.badge.default")} />
                          )}
                          {provider.tier && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={
                                provider.tier === "cloud_free_tier"
                                  ? tr("providers.badge.cloudFreeTier")
                                  : provider.tier
                              }
                            />
                          )}
                          {provider.details?.local !== undefined && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={provider.details.local ? tr("providers.badge.local") : tr("providers.badge.cloud")}
                            />
                          )}
                          {provider.vaultConfigured && (
                            <Chip
                              size="small"
                              color="success"
                              variant="outlined"
                              label={tr("providers.badge.vaultConfigured")}
                            />
                          )}
                          {provider.details?.liveVerified === true && (
                            <Chip size="small" color="success" label={tr("providers.badge.liveVerified")} />
                          )}
                          {provider.configured && provider.details?.liveVerified === false && (
                            <Chip
                              size="small"
                              color="warning"
                              variant="outlined"
                              label={tr("providers.badge.notLiveVerified")}
                            />
                          )}
                          {typeof provider.details?.accountTier === "string" && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={tr("providers.badge.tier", { tier: provider.details.accountTier })}
                            />
                          )}
                          {typeof provider.details?.lastTestedAt === "string" && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={tr("providers.badge.lastTested", {
                                time: format.dateTime(provider.details.lastTestedAt as string),
                              })}
                            />
                          )}
                          {provider.canonical?.lastVerifiedAt && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`Last verified ${format.dateTime(provider.canonical.lastVerifiedAt)}`}
                            />
                          )}
                        </Stack>
                        {provider.canonical?.capabilities?.length ? (
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {provider.canonical.capabilities.slice(0, 6).map((capability) => (
                              <Chip key={capability} size="small" label={capability} />
                            ))}
                          </Stack>
                        ) : null}
                        {provider.canonical?.blockerReason && (
                          <Alert severity="warning">{provider.canonical.blockerReason}</Alert>
                        )}
                        {provider.vault?.length ? (
                          <Stack spacing={0.5}>
                            {provider.vault.map((credential) => (
                              <Typography key={credential.credentialType} variant="caption" color="text.secondary">
                                <Box component="span">{credentialTypeLabel(credential.credentialType)}</Box>:{" "}
                                {credential.maskedHint || "••••"} · {tr(localizedStatus(credential.health).key)}
                              </Typography>
                            ))}
                          </Stack>
                        ) : null}
                        {provider.category === "Voice" && provider.details && (
                          <Stack spacing={0.5}>
                            <Typography variant="caption" color="text.secondary">
                              {tr("providers.detail.languages", {
                                list: Array.isArray(provider.details.languages)
                                  ? provider.details.languages.join("، ")
                                  : tr("common.unknown"),
                              })}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {tr("providers.detail.arabicEgyptian", {
                                arabic: String(provider.details.arabicSupport || tr("common.unknown")),
                                egyptian: String(provider.details.egyptianSupport || tr("common.unknown")),
                              })}
                            </Typography>
                            {provider.details.license && (
                              <Typography variant="caption" color="text.secondary">
                                {tr("providers.detail.license", { value: String(provider.details.license) })}
                              </Typography>
                            )}
                            {provider.details.authentication && (
                              <Typography variant="caption" color="text.secondary">
                                {tr("providers.detail.authentication", {
                                  value: String(provider.details.authentication),
                                })}
                              </Typography>
                            )}
                            {provider.details.freeTierLabel && (
                              <Typography variant="caption" color="text.secondary">
                                {tr("providers.detail.tier", { value: String(provider.details.freeTierLabel) })}
                              </Typography>
                            )}
                            {provider.details.billingNotice && (
                              <Typography variant="caption" color="text.secondary">
                                {String(provider.details.billingNotice)}
                              </Typography>
                            )}
                            {Array.isArray(provider.details.voiceFamilies) && provider.details.voiceFamilies.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                {tr("providers.detail.families", { list: provider.details.voiceFamilies.join("، ") })}
                              </Typography>
                            )}
                            {provider.id === "elevenlabs" && (
                              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={tr("providers.detail.credential", {
                                    state: provider.details.credentialStored
                                      ? tr("providers.detail.credentialStored")
                                      : tr("providers.detail.credentialNotStored"),
                                  })}
                                  color={provider.details.credentialStored ? "success" : "default"}
                                />
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={tr("providers.detail.connection", {
                                    state:
                                      provider.details.authenticated === undefined
                                        ? tr("providers.detail.connectionNotTested")
                                        : provider.details.authenticated
                                          ? tr("providers.detail.connectionAuthenticated")
                                          : tr("providers.detail.connectionFailed"),
                                  })}
                                  color={
                                    provider.details.authenticated
                                      ? "success"
                                      : provider.details.authenticated === false
                                        ? "error"
                                        : "default"
                                  }
                                />
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={tr("providers.detail.voices", {
                                    state:
                                      provider.details.voiceDiscoveryAvailable === undefined
                                        ? tr("providers.detail.voicesNotTested")
                                        : provider.details.voiceDiscoveryAvailable
                                          ? tr("providers.detail.voicesFound", {
                                              count: provider.details.voicesDiscovered ?? 0,
                                            })
                                          : tr("providers.detail.voicesRestricted"),
                                  })}
                                  color={
                                    provider.details.voiceDiscoveryAvailable
                                      ? "success"
                                      : provider.details.voiceDiscoveryAvailable === false
                                        ? "error"
                                        : "default"
                                  }
                                />
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={tr("providers.detail.tts", {
                                    state:
                                      provider.details.ttsReady === undefined
                                        ? tr("providers.detail.ttsNotTested")
                                        : provider.details.ttsReady
                                          ? tr("providers.detail.ttsReady")
                                          : tr("providers.detail.ttsNotReady"),
                                  })}
                                  color={
                                    provider.details.ttsReady
                                      ? "success"
                                      : provider.details.ttsReady === false
                                        ? "warning"
                                        : "default"
                                  }
                                />
                                <Chip
                                  size="small"
                                  variant={provider.details.liveVerified ? "filled" : "outlined"}
                                  label={
                                    provider.details.liveVerified
                                      ? tr("providers.badge.liveVerified")
                                      : tr("providers.badge.notLiveVerified")
                                  }
                                  color={provider.details.liveVerified ? "success" : "default"}
                                />
                                <Chip
                                  size="small"
                                  variant={provider.details.arabicProductionReady ? "filled" : "outlined"}
                                  label={
                                    provider.details.arabicProductionReady
                                      ? tr("providers.badge.arabicReady")
                                      : tr("providers.badge.arabicSetupRequired")
                                  }
                                  color={provider.details.arabicProductionReady ? "success" : "warning"}
                                />
                              </Stack>
                            )}
                            {provider.id === "elevenlabs" && provider.details.errorDetail && (() => {
                              const errorDetail = provider.details.errorDetail as {
                                category?: string;
                                upstreamMessage?: string;
                                requestId?: string;
                              };
                              return (
                                <Typography variant="caption" color="error.main">
                                  {String(errorDetail.upstreamMessage || errorDetail.category)}
                                  {errorDetail.requestId
                                    ? ` ${tr("providers.detail.requestId", { id: errorDetail.requestId })}`
                                    : ""}
                                </Typography>
                              );
                            })()}
                          </Stack>
                        )}
                        <Divider />
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                          {provider.credentialTypes && provider.credentialTypes.length > 0 && !["local_ai", "kokoro", "piper", "whisper_cpp", "remotion", "ffmpeg", "n8n", "postgres"].includes(provider.id || "") && (
                            <Button
                              size="small"
                              startIcon={<SettingsIcon />}
                              onClick={() => openCredentialDialog(provider)}
                            >
                              {provider.vaultConfigured
                                ? tr("providers.replaceCredentials")
                                : tr("common.configure")}
                            </Button>
                          )}
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={validatingProvider === provider.name}
                            onClick={() => testProviderConnection(provider)}
                          >
                            {provider.configured === false
                              ? tr("providers.notConfigured")
                              : validatingProvider === provider.name
                                ? tr("providers.testing")
                                : tr("common.testConnection")}
                          </Button>
                          <Button size="small" variant="outlined" disabled>
                            {provider.canonical?.enabled === false ? "Enable" : "Disable"}
                          </Button>
                          {provider.id === "elevenlabs" && (
                            <>
                              <Button size="small" onClick={() => openVoiceLab({ browseOnly: true })}>
                                {tr("providers.voiceLab.browseVoices")}
                              </Button>
                              <Button size="small" variant="contained" onClick={() => openVoiceLab()}>
                                {tr("providers.voiceLab.open")}
                              </Button>
                            </>
                          )}
                          {provider.vaultConfigured && (
                            <Button size="small" color="error" onClick={() => disconnectProvider(provider)}>
                              {tr("common.disconnect")}
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    </SectionCard>
                  </Grid>
                ))}
              </Grid>
            </SectionCard>
          </Grid>
        ))}
      </Grid>

      <Dialog open={voiceLabOpen} onClose={() => setVoiceLabOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{browseOnly ? tr("providers.voiceLab.browseTitle") : tr("providers.voiceLab.title")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {voiceLabConfig && !voiceLabConfig.configured && (
              <Alert severity="error">{tr("providers.voiceLab.needsKey")}</Alert>
            )}
            {voiceLabError && <Alert severity="warning">{voiceLabError}</Alert>}
            <Alert severity="info">{tr("providers.voiceLab.auditionOnly")}</Alert>

            {voiceLabLoading ? (
              <Typography variant="body2">{tr("providers.voiceLab.loadingVoices")}</Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" variant="outlined" label={tr("providers.voiceLab.model", { model: voiceLabConfig?.model || "—" })} />
                  <Chip size="small" variant="outlined" label={tr("providers.voiceLab.voicesDiscovered", { count: voiceLabVoices.length })} />
                  <Chip size="small" variant="outlined" label={tr("providers.voiceLab.usageBased")} />
                  {voiceLabConfig?.arabicProductionReady && (
                    <Chip size="small" color="success" label={tr("providers.badge.arabicReady")} />
                  )}
                </Stack>

                <TextField
                  label={tr("providers.voiceLab.search")}
                  value={voiceLabSearch}
                  onChange={(e) => setVoiceLabSearch(e.target.value)}
                  fullWidth
                />

                <TextField
                  select
                  label={tr("providers.voiceLab.voice")}
                  value={voiceLabVoiceId}
                  onChange={(e) => setVoiceLabVoiceId(e.target.value)}
                  fullWidth
                  SelectProps={{ native: true }}
                  InputLabelProps={{ shrink: true }}
                >
                  <option value="">{tr("providers.voiceLab.selectVoice")}</option>
                  {filteredVoiceLabVoices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {[voice.name, voice.accent, voice.gender, voice.category].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </TextField>

                {!browseOnly && (
                  <>
                    <Stack direction="row" spacing={2}>
                      <TextField
                        select
                        label={tr("providers.voiceLab.language")}
                        value={voiceLabLanguage}
                        onChange={(e) => setVoiceLabLanguage(e.target.value)}
                        fullWidth
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        <option value="ar">{tr("settings.field.languageArabic")}</option>
                        <option value="en">{tr("settings.field.languageEnglish")}</option>
                      </TextField>
                      <TextField
                        select
                        label={tr("providers.voiceLab.targetDialect")}
                        value={voiceLabDialect}
                        onChange={(e) => setVoiceLabDialect(e.target.value)}
                        fullWidth
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        <option value="egyptian">{tr("providers.voiceLab.dialectEgyptian")}</option>
                        <option value="msa">{tr("providers.voiceLab.dialectMsa")}</option>
                      </TextField>
                      <TextField
                        select
                        label={tr("providers.voiceLab.preset")}
                        value={voiceLabPreset}
                        onChange={(e) => setVoiceLabPreset(e.target.value)}
                        fullWidth
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        {(voiceLabConfig?.presets || []).map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.id}</option>
                        ))}
                      </TextField>
                    </Stack>

                    <TextField
                      label={tr("providers.voiceLab.auditionText")}
                      value={voiceLabText}
                      onChange={(e) => setVoiceLabText(e.target.value)}
                      fullWidth
                      multiline
                      minRows={4}
                      helperText={tr("providers.voiceLab.auditionHelp")}
                      inputProps={{ maxLength: voiceLabConfig?.maxCharacters || 600, dir: "auto" }}
                    />

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Button
                        variant="contained"
                        disabled={
                          voiceLabGenerating ||
                          !voiceLabConfig?.previewSynthesisAllowed ||
                          !voiceLabVoiceId ||
                          !voiceLabText.trim()
                        }
                        onClick={generateVoiceLabPreview}
                      >
                        {voiceLabGenerating
                          ? tr("providers.voiceLab.generating")
                          : voiceLabAudio
                            ? tr("providers.voiceLab.regenerate")
                            : tr("providers.voiceLab.generatePreview")}
                      </Button>
                      <Button
                        disabled={!voiceLabVoiceId}
                        onClick={saveDefaultArabicVoice}
                      >
                        {tr("providers.voiceLab.setDefaultArabic")}
                      </Button>
                      {!voiceLabConfig?.previewSynthesisAllowed && (
                        <Chip size="small" variant="outlined" label={tr("providers.voiceLab.previewPendingAuth")} />
                      )}
                    </Stack>

                    {voiceLabAudio && (
                      <audio controls src={voiceLabAudio} style={{ width: "100%" }} />
                    )}

                    {defaultArabicVoiceId && (
                      <Alert severity="success">
                        {tr("providers.voiceLab.defaultSelected", {
                          name: voiceLabVoices.find((v) => v.id === defaultArabicVoiceId)?.name || defaultArabicVoiceId,
                        })}
                      </Alert>
                    )}
                  </>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoiceLabOpen(false)}>{tr("common.close")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(credentialProvider)} onClose={() => setCredentialProvider(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {credentialProvider?.vaultConfigured
            ? tr("providers.credential.dialogTitleReplace")
            : tr("providers.credential.dialogTitle")}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">{tr("providers.credential.encryptedNote")}</Alert>
            <Typography variant="subtitle2" fontWeight={800}>
              {credentialProvider?.name}
            </Typography>
            <TextField
              select
              label={tr("providers.credential.type")}
              value={credentialType}
              onChange={(e) => setCredentialType(e.target.value)}
              fullWidth
              SelectProps={{ native: true }}
            >
              {(credentialProvider?.credentialTypes || ["api_key"]).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </TextField>
            <TextField
              label={
                credentialType === "service_account_json"
                  ? tr("providers.credential.serviceAccountJson")
                  : tr("providers.credential.value")
              }
              type={credentialType.includes("json") ? "text" : "password"}
              value={credentialValue}
              onChange={(e) => setCredentialValue(e.target.value)}
              fullWidth
              multiline={credentialType.includes("json")}
              minRows={credentialType.includes("json") ? 5 : undefined}
              autoComplete="off"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCredentialProvider(null)}>{tr("common.cancel")}</Button>
          <Button variant="contained" disabled={savingCredential || !credentialValue.trim()} onClick={saveCredential}>
            {savingCredential ? tr("common.saving") : tr("providers.saveEncrypted")}
          </Button>
        </DialogActions>
      </Dialog>

      <SectionCard
        title={tr("settings.security.title")}
        description={tr("settings.security.description")}
      >
        <ApiTokenManager />
      </SectionCard>
    </>
  );
};

/**
 * APPLICATION ACCESS TOKENS (moved here in V2.5.1)
 * ------------------------------------------------
 * These are tokens for wiring an external system into this installation. They
 * were on the customer Settings page, where the person making videos had to
 * scroll past a scope list to reach Backup. This product runs as
 * LOCAL_SINGLE_USER on the owner's own machine and needs none of them to work,
 * so they belong on the technical surface with the rest of the developer
 * controls. Internal service authentication is untouched.
 */
const API_SCOPES = ["production:create", "production:read", "videos:read", "publishing:write"];

const ApiTokenManager: React.FC = () => {
  const { t: tr, format } = useI18n();
  const [tokens, setTokens] = useState<ApiTokenItem[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["production:create", "production:read"]);
  const [shownToken, setShownToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await axios.get("/api/v2/api-tokens");
    setTokens(res.data.tokens || []);
  };

  useEffect(() => {
    load().catch(() => setError(tr("settings.token.loadFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleScope = (scope: string) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const createToken = async () => {
    setError(null);
    try {
      const res = await axios.post("/api/v2/api-tokens", { name, scopes });
      setShownToken(res.data.token?.token || null);
      setName("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || tr("settings.token.createFailed"));
    }
  };

  const revoke = async (id: string) => {
    await axios.post(`/api/v2/api-tokens/${id}/revoke`);
    await load();
  };

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {shownToken && (
        <Alert severity="warning" onClose={() => setShownToken(null)}>
          {tr("settings.token.newOnce")}{" "}
          <Box component="code" dir="ltr" sx={{ display: "inline-block" }}>{shownToken}</Box>
        </Alert>
      )}
      <Grid container spacing={1.5}>
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            label={tr("settings.token.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {API_SCOPES.map((scope) => (
              <FormControlLabel
                key={scope}
                control={<Checkbox checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />}
                label={<Box component="span" dir="ltr">{scope}</Box>}
              />
            ))}
          </Stack>
        </Grid>
        <Grid item xs={12} md={2}>
          <Button fullWidth variant="contained" disabled={!name || scopes.length === 0} onClick={createToken}>
            {tr("settings.token.create")}
          </Button>
        </Grid>
      </Grid>
      <Stack spacing={1}>
        {tokens.map((token) => (
          <Box key={token.id} sx={{ display: "flex", justifyContent: "space-between", gap: 1, p: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <Box>
              <Typography variant="body2" fontWeight={800}>{token.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                <Box component="span" dir="ltr">{token.scopes.join(", ")}</Box> ·{" "}
                {tr("settings.token.createdOn", { time: format.dateTime(token.createdAt) })}
                {token.lastUsedAt
                  ? ` · ${tr("settings.token.lastUsed", { time: format.dateTime(token.lastUsedAt) })}`
                  : ""}
              </Typography>
            </Box>
            <Button size="small" color="error" disabled={Boolean(token.revokedAt)} onClick={() => revoke(token.id)}>
              {token.revokedAt ? tr("settings.token.revoked") : tr("settings.token.revoke")}
            </Button>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
};

export default ProvidersPage;
