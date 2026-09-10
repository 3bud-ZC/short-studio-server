/**
 * CREATE VIDEO (V2.5.1)
 * ---------------------
 * One page, one flow, one form.
 *
 * What this replaced, and why:
 *   - Prompt Mode / Template Mode tabs. A template is a starting point, not a
 *     different product. Opening one now prefills this same page.
 *   - Simple / Advanced modes. Hiding real functionality behind a mode toggle
 *     means half the customers never find it and the other half wonder what
 *     they are missing. Everything that matters is here, grouped.
 *   - The Video Type selector. The engine already infers the treatment from the
 *     prompt, the shape and the media strategy; asking the customer to also
 *     name a production mode was asking them to do the engine's job.
 *   - Six Example Ideas, three in Arabic and three in English, all six shown in
 *     both interface languages. They were the single largest source of mixed
 *     language copy in the product. Replaced by the Prompt Builder.
 *   - Brand Profiles, product-composition fields, character profiles, budget
 *     modes and raw provider enums, none of which a customer of this product
 *     needs to reason about.
 *
 * The sections are Prompt, Video, Voice, Media, Captions and Review & Create.
 * Every string resolves through the translation catalogue, so an English screen
 * carries no Arabic and an Arabic screen carries no English.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PermMediaIcon from "@mui/icons-material/PermMedia";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SendIcon from "@mui/icons-material/Send";
import TipsAndUpdatesIcon from "@mui/icons-material/TipsAndUpdates";
import CloseIcon from "@mui/icons-material/Close";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";

import { LoadingState, PageHeader, SectionCard } from "../components/v2";
import { useI18n } from "../i18n";
import { localizedApiError } from "../utils/localizedApiError";
import { withMediaAccessToken } from "../utils/auth";
import type { BusinessTemplateOption, ProviderItem } from "./v2Types";
import { promptBuilderTemplate } from "./promptBuilder";
import {
  ASPECT_OPTIONS,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_PRESETS,
  MEDIA_SOURCE_OPTIONS,
  PRODUCTION_SAFE_CAPTION_STYLE,
  QUALITY_OPTIONS,
  customerMediaSourceFrom,
  customerQualityFrom,
  engineMediaContract,
  engineQualityContract,
  voiceChoicesFor,
  type CustomerAspect,
  type CustomerDialect,
  type CustomerLanguage,
  type CustomerMediaSource,
  type CustomerQuality,
  type CustomerStockProvider,
} from "./createOptions";

const PROMPT_MAX = 4000;

type MediaLibraryAsset = {
  id: string;
  filename: string;
  originalName?: string;
  displayName?: string;
  mediaType: "image" | "video" | "audio";
  previewUrl?: string;
  usable?: boolean;
  usability?: { usableForVideo?: boolean };
};

function assetIsUsableForVideo(asset: MediaLibraryAsset): boolean {
  if (asset.mediaType === "audio") return false;
  if (asset.usability?.usableForVideo === false) return false;
  return asset.usable !== false;
}

function assetPreview(asset: MediaLibraryAsset): string {
  return withMediaAccessToken(asset.previewUrl || `/api/v2/media/uploads/${asset.filename}`);
}

function assetName(asset: MediaLibraryAsset): string {
  return asset.displayName || asset.originalName || asset.filename;
}

const VideoCreator: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { locale, t, format } = useI18n();

  // ---------------------------------------------------------------- prompt
  const [prompt, setPrompt] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceResult, setEnhanceResult] = useState<{ enhancedPrompt?: string } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderCopied, setBuilderCopied] = useState(false);

  // ----------------------------------------------------------------- video
  const [language, setLanguage] = useState<CustomerLanguage>(locale === "ar" ? "ar" : "en");
  const [dialect, setDialect] = useState<CustomerDialect>("egyptian");
  const [duration, setDuration] = useState<number>(20);
  const [customDuration, setCustomDuration] = useState(false);
  const [aspect, setAspect] = useState<CustomerAspect>("9:16");
  const [quality, setQuality] = useState<CustomerQuality>("high");
  const [captionsOn, setCaptionsOn] = useState(true);

  // ----------------------------------------------------------------- voice
  const [voiceProvider, setVoiceProvider] = useState<string>("auto");
  const [voiceId, setVoiceId] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [resolvedVoiceProvider, setResolvedVoiceProvider] = useState("auto");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [voiceBlockedReason, setVoiceBlockedReason] = useState<string | null>(null);
  const [voicePreviewing, setVoicePreviewing] = useState(false);
  const [voicePreview, setVoicePreview] = useState<{ audioUrl?: string } | null>(null);
  const [paidPreviewConfirm, setPaidPreviewConfirm] = useState(false);

  // ----------------------------------------------------------------- media
  const [mediaSource, setMediaSource] = useState<CustomerMediaSource>("automatic");
  const [stockProvider, setStockProvider] = useState<CustomerStockProvider>("auto_stock");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaLibraryAsset[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<"all" | "image" | "video">("all");
  const [pickerSearch, setPickerSearch] = useState("");

  // -------------------------------------------------------------- template
  const [appliedTemplate, setAppliedTemplate] = useState<BusinessTemplateOption | null>(null);

  // ----------------------------------------------------------------- shell
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voiceChoices = useMemo(() => voiceChoicesFor(language), [language]);

  const providerConfigured = useCallback(
    (id?: string) => {
      if (!id) return true;
      const entry = providers.find((provider) => provider.id === id);
      return Boolean(entry && entry.configured !== false);
    },
    [providers],
  );

  const activeVoice = useMemo(
    () => voiceChoices.find((choice) => choice.id === voiceProvider) || voiceChoices[0],
    [voiceChoices, voiceProvider],
  );

  // A language change can strand a voice that does not exist for the new
  // language (Kokoro on an Arabic production). Falling back to Recommended is
  // the only choice that cannot produce a bad video.
  useEffect(() => {
    if (!voiceChoices.some((choice) => choice.id === voiceProvider)) {
      setVoiceProvider("auto");
      setVoiceId("");
    }
  }, [voiceChoices, voiceProvider]);

  // ------------------------------------------------------------- data load
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get("/api/v2/providers").catch(() => ({ data: { providers: [] } })),
      axios.get("/api/v2/media/assets").catch(() => ({ data: { assets: [] } })),
      params.get("template")
        ? axios.get("/api/v2/templates").catch(() => ({ data: { templates: [] } }))
        : Promise.resolve({ data: { templates: [] } }),
    ])
      .then(([providerResponse, mediaResponse, templateResponse]) => {
        if (cancelled) return;
        setProviders(providerResponse.data.providers || []);
        setMediaAssets(mediaResponse.data.assets || []);

        const templateId = params.get("template");
        if (!templateId) return;
        const template = (templateResponse.data.templates || []).find(
          (item: BusinessTemplateOption) => item.id === templateId,
        );
        if (template) applyTemplate(template);
      })
      .catch(() => {
        if (!cancelled) setError(t("create.error.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Voice compatibility for the chosen language, straight from the server so
  // the form can never claim a route the engine would refuse.
  useEffect(() => {
    axios
      .get("/api/v2/voices", {
        params: {
          provider: voiceProvider,
          language,
          dialect: language === "ar" ? dialect : "none",
        },
      })
      .then((response) => {
        setVoiceOptions(response.data.voices || []);
        setResolvedVoiceProvider(response.data.resolvedProvider || voiceProvider);
        setVoiceBlocked(Boolean(response.data.blocked));
        setVoiceBlockedReason(response.data.blockedReasonCode || null);
        if (voiceId && !(response.data.voices || []).some((voice: any) => voice.id === voiceId)) {
          setVoiceId("");
        }
      })
      .catch(() => {
        setVoiceOptions([]);
        setVoiceBlocked(false);
        setVoiceBlockedReason(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, dialect, voiceProvider]);

  /** Prefills the form from a template without locking any of it. */
  function applyTemplate(template: BusinessTemplateOption) {
    setAppliedTemplate(template);
    const config = template.config || {};
    const starter = config.promptGuidance || template.examplePrompt || "";
    if (starter) setPrompt(String(starter));
    const seconds = Number(
      config.durationSeconds || template.targetDurationSeconds || template.suggestedDurationSeconds || 0,
    );
    if (seconds >= DURATION_MIN && seconds <= DURATION_MAX) {
      setDuration(seconds);
      setCustomDuration(!DURATION_PRESETS.includes(seconds as any));
    }
    if (config.aspectRatio === "9:16" || config.aspectRatio === "16:9" || config.aspectRatio === "1:1") {
      setAspect(config.aspectRatio);
    }
    if (config.quality) setQuality(customerQualityFrom(String(config.quality)));
    if (config.language === "ar" || config.language === "en") setLanguage(config.language);
    if (config.dialect === "egyptian" || config.dialect === "msa") setDialect(config.dialect);
    if (config.captionStyle === "none") setCaptionsOn(false);
    setMediaSource(
      customerMediaSourceFrom({
        visualSource: config.visualSource,
        mediaPolicy: config.mediaPolicy,
        productionMode: config.productionMode,
      }),
    );
    if (config.stockProvider === "pexels" || config.stockProvider === "pixabay") {
      setStockProvider(config.stockProvider);
    }
    if (Array.isArray(config.selectedMediaIds)) {
      setSelectedMediaIds(config.selectedMediaIds.map(String));
    }
    if (config.voiceProvider && typeof config.voiceProvider === "string") {
      setVoiceProvider(config.voiceProvider);
    }
  }

  function clearTemplate() {
    setAppliedTemplate(null);
    setPrompt("");
  }

  // -------------------------------------------------------------- requests
  const mediaContract = useMemo(() => engineMediaContract(mediaSource), [mediaSource]);
  const qualityContract = useMemo(() => engineQualityContract(quality), [quality]);
  const usesOwnMedia = mediaSource === "my_media_only" || mediaSource === "prefer_my_media";
  const selectableAssets = useMemo(
    () => mediaAssets.filter(assetIsUsableForVideo),
    [mediaAssets],
  );
  const selectedAssets = useMemo(
    () =>
      selectedMediaIds
        .map((id) => selectableAssets.find((asset) => asset.id === id))
        .filter(Boolean) as MediaLibraryAsset[],
    [selectedMediaIds, selectableAssets],
  );

  const premiumVoiceUnavailable =
    Boolean(activeVoice?.requiresProvider) && !providerConfigured(activeVoice?.requiresProvider);

  function blockingReason(): string | null {
    if (!prompt.trim()) return t("create.error.promptRequired");
    if (premiumVoiceUnavailable) return t("create.error.providerNotConfigured");
    if (voiceBlocked) {
      return voiceBlockedReason === "elevenlabs_not_configured"
        ? t("create.voiceGuidance.elevenlabsNotConfigured")
        : t("create.voiceGuidance.localVoiceSetupRequired");
    }
    if (usesOwnMedia && selectedMediaIds.length === 0) return t("create.media.needSelection");
    return null;
  }

  const blocked = blockingReason();

  function jobPayload() {
    return {
      creationMode: "prompt" as const,
      prompt: prompt.trim(),
      language,
      dialect: language === "ar" ? dialect : ("none" as const),
      durationSeconds: duration,
      aspectRatio: aspect,
      quality: qualityContract.quality,
      resolution: qualityContract.resolution,
      productionMode: mediaContract.productionMode,
      visualMode: mediaContract.visualMode,
      visualSource: mediaContract.visualSource,
      mediaPolicy: mediaContract.mediaPolicy,
      stockProvider,
      selectedMediaIds,
      voiceProvider,
      voiceId: voiceId || undefined,
      captionEnabled: captionsOn,
      captionStyle: captionsOn ? PRODUCTION_SAFE_CAPTION_STYLE : ("none" as const),
      templateId: appliedTemplate?.id,
      // Everything the request layer needs to reconstruct this exact customer
      // choice on a retry, without a second source of truth.
      metadata: {
        selectedMediaIds,
        mediaPolicy: mediaContract.mediaPolicy,
        stockProvider,
        visualSource: mediaContract.visualSource,
      },
    };
  }

  async function handleImprovePrompt() {
    if (!prompt.trim()) return;
    setEnhancing(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/prompt/enhance", {
        prompt,
        language,
        dialect: language === "ar" ? dialect : undefined,
      });
      setEnhanceResult(response.data);
    } catch {
      setError(t("create.error.enhanceFailed"));
    } finally {
      setEnhancing(false);
    }
  }

  async function handleVoicePreview() {
    const sample = prompt.trim().slice(0, 300);
    if (!sample) return;
    setVoicePreviewing(true);
    setVoicePreview(null);
    setError(null);
    try {
      const response = await axios.post("/api/voice-preview", {
        text: sample,
        language,
        dialect: language === "ar" ? dialect : "none",
        provider: voiceProvider,
        voiceId: voiceId || undefined,
      });
      setVoicePreview(response.data);
    } catch {
      setError(t("create.error.voicePreviewFailed"));
    } finally {
      setVoicePreviewing(false);
      setPaidPreviewConfirm(false);
    }
  }

  async function handleSubmit() {
    const reason = blockingReason();
    if (reason) {
      setError(reason);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/jobs", jobPayload(), {
        headers: {
          "Idempotency-Key": `create-${Date.now()}-${
            crypto.randomUUID?.() || Math.random().toString(36).slice(2)
          }`,
        },
      });
      navigate(`/jobs/${response.data.job.id}`);
    } catch (error) {
      setError(localizedApiError(error, locale, t("create.error.submitFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function copyPromptBuilder() {
    const template = promptBuilderTemplate(locale);
    const done = () => {
      setBuilderCopied(true);
      window.setTimeout(() => setBuilderCopied(false), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(template).then(done).catch(done);
    } else {
      done();
    }
  }

  function toggleMedia(id: string) {
    setSelectedMediaIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function moveMedia(index: number, delta: number) {
    setSelectedMediaIds((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const pickerAssets = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    return selectableAssets.filter((asset) => {
      if (pickerFilter !== "all" && asset.mediaType !== pickerFilter) return false;
      if (!query) return true;
      return assetName(asset).toLowerCase().includes(query);
    });
  }, [selectableAssets, pickerFilter, pickerSearch]);

  if (loading) return <LoadingState label={t("common.loading")} />;

  const mediaSourceLabelKey =
    MEDIA_SOURCE_OPTIONS.find((option) => option.id === mediaSource)?.labelKey ||
    "create.media.automatic";

  return (
    <>
      <PageHeader
        title={t("create.title")}
        eyebrow={t("create.eyebrow")}
        description={t("create.subtitle")}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {appliedTemplate && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button size="small" color="inherit" onClick={clearTemplate}>
              {t("create.template.clear")}
            </Button>
          }
        >
          {t("create.template.applied", { name: appliedTemplate.displayName })}
        </Alert>
      )}

      <Stack spacing={2.5}>
        {/* ------------------------------------------------------- Prompt */}
        <SectionCard title={t("create.section.prompt")} description={t("create.section.promptHint")}>
          <TextField
            fullWidth
            multiline
            minRows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, PROMPT_MAX))}
            label={t("create.prompt.label")}
            placeholder={t("create.prompt.placeholder")}
          />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
            sx={{ mt: 1.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              {t("create.prompt.counter", { count: prompt.length, max: PROMPT_MAX })}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="outlined"
                startIcon={<TipsAndUpdatesIcon />}
                onClick={() => setBuilderOpen(true)}
              >
                {t("create.prompt.builder")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AutoAwesomeIcon />}
                disabled={!prompt.trim() || enhancing}
                onClick={handleImprovePrompt}
              >
                {enhancing ? t("create.prompt.improving") : t("create.prompt.improve")}
              </Button>
            </Stack>
          </Stack>
        </SectionCard>

        {/* -------------------------------------------------------- Video */}
        <SectionCard title={t("create.section.video")} description={t("create.section.videoHint")}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth>
                <InputLabel id="create-language">{t("create.language.label")}</InputLabel>
                <Select
                  labelId="create-language"
                  label={t("create.language.label")}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as CustomerLanguage)}
                >
                  <MenuItem value="en">{t("create.language.english")}</MenuItem>
                  <MenuItem value="ar">{t("create.language.arabic")}</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {language === "ar" && (
              <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth>
                  <InputLabel id="create-dialect">{t("create.dialect.label")}</InputLabel>
                  <Select
                    labelId="create-dialect"
                    label={t("create.dialect.label")}
                    value={dialect}
                    onChange={(event) => setDialect(event.target.value as CustomerDialect)}
                  >
                    <MenuItem value="egyptian">{t("create.dialect.egyptian")}</MenuItem>
                    <MenuItem value="msa">{t("create.dialect.msa")}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            )}

            <Grid item xs={12} sm={6} md={4}>
              {customDuration ? (
                <TextField
                  fullWidth
                  type="number"
                  label={t("create.duration.label")}
                  helperText={t("create.duration.customHint", { min: DURATION_MIN, max: DURATION_MAX })}
                  value={duration}
                  inputProps={{ min: DURATION_MIN, max: DURATION_MAX }}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) {
                      setDuration(Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(next))));
                    }
                  }}
                  onBlur={() => {
                    if (DURATION_PRESETS.includes(duration as any)) setCustomDuration(false);
                  }}
                />
              ) : (
                <FormControl fullWidth>
                  <InputLabel id="create-duration">{t("create.duration.label")}</InputLabel>
                  <Select
                    labelId="create-duration"
                    label={t("create.duration.label")}
                    value={DURATION_PRESETS.includes(duration as any) ? duration : "custom"}
                    onChange={(event) => {
                      if (event.target.value === "custom") {
                        setCustomDuration(true);
                        return;
                      }
                      setDuration(Number(event.target.value));
                    }}
                  >
                    {DURATION_PRESETS.map((seconds) => (
                      <MenuItem key={seconds} value={seconds}>
                        {t("create.duration.seconds", { count: format.number(seconds) })}
                      </MenuItem>
                    ))}
                    <MenuItem value="custom">{t("create.duration.custom")}</MenuItem>
                  </Select>
                </FormControl>
              )}
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("create.aspect.label")}
              </Typography>
              <ToggleButtonGroup
                exclusive
                value={aspect}
                onChange={(_event, next) => next && setAspect(next as CustomerAspect)}
                sx={{ flexWrap: "wrap" }}
              >
                {ASPECT_OPTIONS.map((option) => (
                  <ToggleButton key={option.id} value={option.id} sx={{ px: 2, textTransform: "none" }}>
                    <Stack alignItems="flex-start" spacing={0.25}>
                      <Typography variant="body2" fontWeight={600}>
                        {t(option.labelKey)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(option.hintKey)}
                      </Typography>
                    </Stack>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("create.quality.label")}
              </Typography>
              <ToggleButtonGroup
                exclusive
                value={quality}
                onChange={(_event, next) => next && setQuality(next as CustomerQuality)}
                sx={{ flexWrap: "wrap" }}
              >
                {QUALITY_OPTIONS.map((option) => (
                  <ToggleButton key={option.id} value={option.id} sx={{ px: 2, textTransform: "none" }}>
                    <Stack alignItems="flex-start" spacing={0.25}>
                      <Typography variant="body2" fontWeight={600}>
                        {t(option.labelKey)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(option.hintKey)}
                      </Typography>
                    </Stack>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Grid>
          </Grid>
        </SectionCard>

        {/* -------------------------------------------------------- Voice */}
        <SectionCard title={t("create.section.voice")} description={t("create.section.voiceHint")}>
          <Grid container spacing={2}>
            {voiceChoices.map((choice) => {
              const unavailable =
                Boolean(choice.requiresProvider) && !providerConfigured(choice.requiresProvider);
              const active = voiceProvider === choice.id;
              return (
                <Grid item xs={12} sm={6} md={3} key={choice.id}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: "100%",
                      borderColor: active ? "primary.main" : undefined,
                      borderWidth: active ? 2 : 1,
                      opacity: unavailable ? 0.6 : 1,
                    }}
                  >
                    <CardActionArea
                      disabled={unavailable}
                      onClick={() => {
                        setVoiceProvider(choice.id);
                        setVoiceId("");
                      }}
                      sx={{ p: 1.75, height: "100%", alignItems: "flex-start" }}
                    >
                      <Stack spacing={0.75} alignItems="flex-start">
                        <Typography variant="subtitle2">{t(choice.labelKey)}</Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={t(choice.tierKey)} variant="outlined" />
                          <Chip
                            size="small"
                            label={t(choice.costKey)}
                            color={choice.costKey === "create.voice.free" ? "success" : "warning"}
                            variant="outlined"
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {t(choice.hintKey)}
                        </Typography>
                        {unavailable && (
                          <Typography variant="caption" color="warning.main">
                            {t("create.voice.notConfigured")}
                          </Typography>
                        )}
                      </Stack>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {voiceOptions.length > 0 && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel id="create-voice-id">{t("create.voice.pickVoice")}</InputLabel>
              <Select
                labelId="create-voice-id"
                label={t("create.voice.pickVoice")}
                value={voiceId}
                onChange={(event) => setVoiceId(String(event.target.value))}
              >
                <MenuItem value="">{t("create.voice.defaultVoice")}</MenuItem>
                {voiceOptions.map((voice) => (
                  <MenuItem key={voice.id} value={voice.id}>
                    {voice.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2">{t("create.voice.review")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("create.voice.reviewHint")}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {t("create.voice.resolved", {
              voice: t(
                voiceChoices.find((choice) => choice.id === resolvedVoiceProvider)?.labelKey ||
                  activeVoice?.labelKey ||
                  "create.voice.auto",
              ),
            })}
          </Typography>
          {activeVoice?.costKey === "create.voice.paid" ? (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              {t("create.voice.previewPaidWarning")}
            </Alert>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              {t("create.voice.previewLocalNote")}
            </Typography>
          )}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              disabled={!prompt.trim() || voicePreviewing || premiumVoiceUnavailable}
              onClick={() => {
                if (activeVoice?.costKey === "create.voice.paid") {
                  setPaidPreviewConfirm(true);
                  return;
                }
                handleVoicePreview();
              }}
            >
              {voicePreviewing ? t("create.voice.previewing") : t("create.voice.preview")}
            </Button>
            {voicePreview?.audioUrl && (
              <audio controls src={withMediaAccessToken(voicePreview.audioUrl)} style={{ maxWidth: "100%" }} />
            )}
          </Stack>

          {voiceBlocked && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {voiceBlockedReason === "elevenlabs_not_configured"
                ? t("create.voiceGuidance.elevenlabsNotConfigured")
                : t("create.voiceGuidance.localVoiceSetupRequired")}
            </Alert>
          )}
        </SectionCard>

        {/* -------------------------------------------------------- Media */}
        <SectionCard title={t("create.section.media")} description={t("create.section.mediaHint")}>
          <Grid container spacing={2}>
            {MEDIA_SOURCE_OPTIONS.map((option) => {
              const active = mediaSource === option.id;
              return (
                <Grid item xs={12} sm={6} md={4} key={option.id}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: "100%",
                      borderColor: active ? "primary.main" : undefined,
                      borderWidth: active ? 2 : 1,
                    }}
                  >
                    <CardActionArea
                      onClick={() => setMediaSource(option.id)}
                      sx={{ p: 1.75, height: "100%", alignItems: "flex-start" }}
                    >
                      <Stack spacing={0.5} alignItems="flex-start">
                        <Typography variant="subtitle2">{t(option.labelKey)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t(option.hintKey)}
                        </Typography>
                      </Stack>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {mediaSource === "stock" && (
            <FormControl fullWidth sx={{ mt: 2, maxWidth: 360 }}>
              <InputLabel id="create-stock">{t("create.media.stockProvider")}</InputLabel>
              <Select
                labelId="create-stock"
                label={t("create.media.stockProvider")}
                value={stockProvider}
                onChange={(event) => setStockProvider(event.target.value as CustomerStockProvider)}
              >
                <MenuItem value="auto_stock">{t("create.media.stockAuto")}</MenuItem>
                <MenuItem value="pexels" disabled={!providerConfigured("pexels")}>
                  {t("create.media.pexels")}
                </MenuItem>
                <MenuItem value="pixabay" disabled={!providerConfigured("pixabay")}>
                  {t("create.media.pixabay")}
                </MenuItem>
              </Select>
            </FormControl>
          )}

          {usesOwnMedia && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button
                  variant="outlined"
                  startIcon={<PermMediaIcon />}
                  onClick={() => setPickerOpen(true)}
                >
                  {selectedMediaIds.length ? t("create.media.changeMedia") : t("create.media.chooseMedia")}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {selectedMediaIds.length
                    ? t("create.media.selectedCount", { count: format.number(selectedMediaIds.length) })
                    : t("create.media.noneSelected")}
                </Typography>
                {selectedMediaIds.length > 0 && (
                  <Button size="small" onClick={() => setSelectedMediaIds([])}>
                    {t("create.media.clear")}
                  </Button>
                )}
              </Stack>

              {selectedAssets.length > 0 && (
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {selectedAssets.map((asset, index) => (
                    <Stack
                      key={asset.id}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}
                    >
                      <Box
                        component="img"
                        src={assetPreview(asset)}
                        alt=""
                        sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 1, flexShrink: 0 }}
                      />
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                        {assetName(asset)}
                      </Typography>
                      <Tooltip title={t("create.media.moveUp")}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={index === 0}
                            onClick={() => moveMedia(index, -1)}
                            aria-label={t("create.media.moveUp")}
                          >
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t("create.media.moveDown")}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={index === selectedAssets.length - 1}
                            onClick={() => moveMedia(index, 1)}
                            aria-label={t("create.media.moveDown")}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t("create.media.remove")}>
                        <IconButton
                          size="small"
                          onClick={() => toggleMedia(asset.id)}
                          aria-label={t("create.media.remove")}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          )}
        </SectionCard>

        {/* ----------------------------------------------------- Captions */}
        <SectionCard title={t("create.section.captions")} description={t("create.section.captionsHint")}>
          <ToggleButtonGroup
            exclusive
            value={captionsOn ? "on" : "off"}
            onChange={(_event, next) => next && setCaptionsOn(next === "on")}
          >
            <ToggleButton value="on" sx={{ px: 3, textTransform: "none" }}>
              {t("create.captions.on")}
            </ToggleButton>
            <ToggleButton value="off" sx={{ px: 3, textTransform: "none" }}>
              {t("create.captions.off")}
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {t("create.captions.hint")}
          </Typography>
        </SectionCard>

        {/* --------------------------------------------- Review & Create */}
        <SectionCard title={t("create.section.review")} description={t("create.section.reviewHint")}>
          <Grid container spacing={1.5}>
            {(
              [
                ["create.review.language", t(language === "ar" ? "create.language.arabic" : "create.language.english")],
                ...(language === "ar"
                  ? ([["create.review.dialect", t(`create.dialect.${dialect}`)]] as Array<[string, string]>)
                  : []),
                ["create.review.duration", t("create.duration.seconds", { count: format.number(duration) })],
                [
                  "create.review.aspect",
                  t(ASPECT_OPTIONS.find((option) => option.id === aspect)!.labelKey),
                ],
                [
                  "create.review.quality",
                  t(QUALITY_OPTIONS.find((option) => option.id === quality)!.labelKey),
                ],
                ["create.review.captions", t(captionsOn ? "create.captions.on" : "create.captions.off")],
                ["create.review.voice", t(activeVoice?.labelKey || "create.voice.auto")],
                ["create.review.voiceProvider", t(activeVoice?.tierKey || "create.voice.local")],
                ["create.review.mediaMode", t(mediaSourceLabelKey)],
                ...(usesOwnMedia
                  ? ([
                      [
                        "create.review.selectedMedia",
                        t("create.media.selectedCount", { count: format.number(selectedMediaIds.length) }),
                      ],
                    ] as Array<[string, string]>)
                  : []),
                ...(mediaSource === "stock"
                  ? ([
                      [
                        "create.review.stockProvider",
                        t(
                          stockProvider === "pexels"
                            ? "create.media.pexels"
                            : stockProvider === "pixabay"
                              ? "create.media.pixabay"
                              : "create.media.stockAuto",
                        ),
                      ],
                    ] as Array<[string, string]>)
                  : []),
                ...(appliedTemplate
                  ? ([["create.review.template", appliedTemplate.displayName]] as Array<[string, string]>)
                  : []),
                [
                  "create.review.paidUsage",
                  activeVoice?.costKey === "create.voice.paid"
                    ? t(activeVoice.labelKey)
                    : t("create.review.noPaidUsage"),
                ],
              ] as Array<[string, string]>
            ).map(([labelKey, value]) => (
              <Grid item xs={12} sm={6} md={4} key={labelKey}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {t(labelKey)}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {value}
                </Typography>
              </Grid>
            ))}
          </Grid>

          {blocked && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {blocked}
            </Alert>
          )}

          <Button
            fullWidth
            size="large"
            variant="contained"
            startIcon={<SendIcon />}
            sx={{ mt: 2.5 }}
            disabled={Boolean(blocked) || submitting}
            onClick={handleSubmit}
          >
            {submitting ? t("create.submitting") : t("create.submit")}
          </Button>
        </SectionCard>
      </Stack>

      {/* ------------------------------------------------- Prompt Builder */}
      <Dialog open={builderOpen} onClose={() => setBuilderOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t("create.prompt.builderTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("create.prompt.builderIntro")}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={12}
            value={promptBuilderTemplate(locale)}
            InputProps={{ readOnly: true }}
            sx={{ fontFamily: "monospace" }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {t("create.prompt.builderPlaceholderNote")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBuilderOpen(false)}>{t("common.close")}</Button>
          <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={copyPromptBuilder}>
            {builderCopied ? t("create.prompt.builderCopied") : t("create.prompt.builderCopy")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --------------------------------------------- Improved prompt */}
      <Dialog open={Boolean(enhanceResult)} onClose={() => setEnhanceResult(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t("create.prompt.enhanceTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={8}
            value={enhanceResult?.enhancedPrompt || ""}
            InputProps={{ readOnly: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnhanceResult(null)}>{t("create.prompt.enhanceKeep")}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (enhanceResult?.enhancedPrompt) setPrompt(enhanceResult.enhancedPrompt);
              setEnhanceResult(null);
            }}
          >
            {t("create.prompt.enhanceUse")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------- Paid preview consent */}
      <Dialog open={paidPreviewConfirm} onClose={() => setPaidPreviewConfirm(false)}>
        <DialogTitle>{t("create.voice.preview")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t("create.voice.previewPaidWarning")}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaidPreviewConfirm(false)}>{t("common.cancel")}</Button>
          <Button variant="contained" color="warning" onClick={handleVoicePreview}>
            {t("create.voice.previewPaidConfirm")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --------------------------------------------------- Media picker */}
      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t("create.media.pickerTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("create.media.pickerHint")}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ mb: 2 }}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={pickerFilter}
              onChange={(_event, next) => next && setPickerFilter(next)}
            >
              <ToggleButton value="all" sx={{ textTransform: "none" }}>
                {t("create.media.filterAll")}
              </ToggleButton>
              <ToggleButton value="image" sx={{ textTransform: "none" }}>
                {t("create.media.filterImages")}
              </ToggleButton>
              <ToggleButton value="video" sx={{ textTransform: "none" }}>
                {t("create.media.filterVideos")}
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              size="small"
              fullWidth
              label={t("create.media.search")}
              value={pickerSearch}
              onChange={(event) => setPickerSearch(event.target.value)}
            />
          </Stack>

          {pickerAssets.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography variant="body2" fontWeight={600}>
                {t("create.media.empty")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                {t("create.media.emptyHint")}
              </Typography>
              <Button variant="outlined" onClick={() => navigate("/media")}>
                {t("create.media.openLibrary")}
              </Button>
            </Box>
          ) : (
            <Grid container spacing={1.5}>
              {pickerAssets.map((asset) => {
                const order = selectedMediaIds.indexOf(asset.id);
                return (
                  <Grid item xs={6} sm={4} md={3} key={asset.id}>
                    <Card
                      variant="outlined"
                      sx={{
                        borderColor: order >= 0 ? "primary.main" : undefined,
                        borderWidth: order >= 0 ? 2 : 1,
                        position: "relative",
                      }}
                    >
                      <CardActionArea onClick={() => toggleMedia(asset.id)}>
                        <Box
                          component="img"
                          src={assetPreview(asset)}
                          alt=""
                          sx={{ width: "100%", height: 110, objectFit: "cover", display: "block" }}
                        />
                        <Box sx={{ p: 1 }}>
                          <Typography variant="caption" sx={{ wordBreak: "break-word" }}>
                            {assetName(asset)}
                          </Typography>
                        </Box>
                      </CardActionArea>
                      {order >= 0 && (
                        <Chip
                          size="small"
                          color="primary"
                          label={format.number(order + 1)}
                          sx={{ position: "absolute", top: 6, insetInlineEnd: 6 }}
                        />
                      )}
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedMediaIds([])}>{t("create.media.clear")}</Button>
          <Button variant="contained" onClick={() => setPickerOpen(false)}>
            {t("create.media.done")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default VideoCreator;
