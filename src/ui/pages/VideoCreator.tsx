import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SendIcon from "@mui/icons-material/Send";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SaveIcon from "@mui/icons-material/Save";
import {
  CaptionPositionEnum,
  MusicMoodEnum,
  MusicVolumeEnum,
  OrientationEnum,
  RenderConfig,
  SceneInput,
  VoiceEnum,
} from "../../types/shorts";
import type { BusinessTemplateId } from "../../short-creator/business-templates";
import { generateScenesForTemplate } from "../../short-creator/templateSceneFactory";
import {
  EmptyState,
  FormSection,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type {
  BusinessTemplateField,
  BusinessTemplateOption,
  CostEstimateData,
  PromptEnhanceResult,
  ProviderItem,
  V2Brand,
} from "./v2Types";
import { withMediaAccessToken } from "../utils/auth";
import { useI18n } from "../i18n";
import { externalCostLabel } from "../../types/costDisplay";
import { ProductionSummary } from "../components/ProductionSummary";
import { CAPTION_STYLE_LABELS, DURATION_OPTIONS, VIDEO_TYPES, videoTypeById, videoTypeByMode } from "./videoTypes";

const EXAMPLE_PROMPTS = [
  {
    title: "براند ملابس شبابي",
    tag: "Arabic",
    prompt:
      "اعمل Reel سريع مدته 20 ثانية لبراند ملابس شبابي. البداية Hook قوي، ركز على الشكل والخامة والراحة، واختم بدعوة واضحة للطلب.",
  },
  {
    title: "كافيه جديد في القاهرة",
    tag: "Arabic",
    prompt:
      "اعمل Reel مدته 15 ثانية لكافيه جديد في القاهرة. ابدأ بلقطة جذابة للقهوة، أظهر الأجواء والقعدة، واختم بدعوة للزيارة.",
  },
  {
    title: "Restaurant Reel",
    tag: "English",
    prompt:
      "Create a 15-second vertical Restaurant Reel for a new dinner offer. Open with a strong food hook, show atmosphere and freshness, and end with a clear booking CTA.",
  },
  {
    title: "SaaS / AI Tool Promo",
    tag: "English",
    prompt:
      "Create a 20-second vertical promo for an AI tool that helps small teams answer customer messages faster. Make it sharp, modern, and benefit-led.",
  },
  {
    title: "معلومة غريبة",
    tag: "Arabic",
    prompt:
      "اعمل فيديو قصير بأسلوب Viral curiosity عن معلومة غريبة ومفيدة في الحياة اليومية. ابدأ بسؤال مثير، ثم اشرحها ببساطة واختم بجملة قابلة للمشاركة.",
  },
  {
    title: "Real Estate Reel",
    tag: "English",
    prompt:
      "Create a 20-second vertical real estate Reel for a bright apartment listing. Highlight space, finish quality, neighborhood convenience, and a viewing CTA.",
  },
];

const CAPTION_STYLES = [
  { id: "clean_professional", label: "Clean" },
  { id: "karaoke", label: "Karaoke" },
  { id: "social_ad", label: "Bold Social" },
  { id: "minimal", label: "Minimal" },
  { id: "cinematic", label: "Cinematic" },
];

const QUALITY_OPTIONS = [
  { id: "draft", label: "Fast", description: "720p render with the quickest local route." },
  { id: "standard", label: "Balanced", description: "1080p render with normal media intelligence." },
  { id: "high", label: "High", description: "Richer pacing and multi-asset scene search where available." },
  { id: "max_quality_local", label: "Maximum", description: "Strongest local quality processors available; no paid AI video by default." },
];

type SceneFormData = { text: string; searchTerms: string };
type VoiceOption = {
  id: string;
  name: string;
  provider: string;
  tier?: string;
  language: string;
  dialect?: string;
  gender?: string;
  voiceFamily?: string;
  sampleRate?: number;
};

type MediaLibraryAsset = {
  id: string;
  filename: string;
  originalName?: string;
  displayName?: string;
  mediaType: "image" | "video" | "audio";
  purpose?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  previewUrl?: string;
  tags?: string[];
  usability?: {
    usableForVideo?: boolean;
    usableForProduct?: boolean;
    usableForLogo?: boolean;
    usableForCharacterReference?: boolean;
  };
  usable?: boolean;
  unusableReason?: string;
};

const creatorCopy = {
  en: {
    character: "Character",
    none: "None",
    refs: "refs",
    referenceReady: "Reference-guided character consistency is available for the selected provider path.",
    referenceUnavailable: "Character consistency requires a compatible AI visual provider. The profile remains saved and reusable.",
    selectedMediaTitle: "Selected Media",
    productMediaTitle: "Product Media & Presentation",
    selectedMediaDescription: "Choose usable media from your library. Invalid items are kept in Media but cannot be selected here.",
    productMediaDescription: "Upload your product image or select a product-capable image asset. Background removal is automatically applied to new product uploads.",
    uploadProduct: "Upload Product Image",
    uploadingProduct: "Uploading & Removing Background...",
    missingProduct: "A Product Ad is built around your product photo, so it cannot be produced without one. Upload or select a product-capable image.",
    missingMedia: "This source needs usable media before Create can run. Upload or select media above.",
    unusableKept: "stored items cannot be used in a video and are not offered here. They are kept in your Media library, where the reason is shown.",
    image: "Image",
    video: "Video",
    audio: "Audio",
    usable: "Usable",
  },
  ar: {
    character: "الشخصية",
    none: "بدون",
    refs: "مراجع",
    referenceReady: "اتساق الشخصية بالمراجع متاح لمسار المزوّد المحدد.",
    referenceUnavailable: "اتساق الشخصية يتطلب مزوّد ذكاء اصطناعي متوافق. سيبقى ملف الشخصية محفوظًا وقابلًا لإعادة الاستخدام.",
    selectedMediaTitle: "الوسائط المحددة",
    productMediaTitle: "وسائط المنتج والعرض",
    selectedMediaDescription: "اختر وسائط صالحة من مكتبتك. العناصر غير الصالحة تبقى في الوسائط ولا يمكن تحديدها هنا.",
    productMediaDescription: "ارفع صورة المنتج أو اختر صورة مناسبة للمنتج. إزالة الخلفية تطبق تلقائيًا على الرفع الجديد.",
    uploadProduct: "رفع صورة منتج",
    uploadingProduct: "جارٍ الرفع وإزالة الخلفية...",
    missingProduct: "إعلان المنتج يعتمد على صورة المنتج، لذلك لا يمكن إنتاجه بدون صورة مناسبة. ارفع أو اختر صورة صالحة.",
    missingMedia: "هذا المصدر يحتاج وسائط صالحة قبل الإنشاء. ارفع أو اختر وسائط أعلاه.",
    unusableKept: "عناصر مخزنة لا يمكن استخدامها في الفيديو ولن تظهر هنا. هي محفوظة في مكتبة الوسائط مع سبب الرفض.",
    image: "صورة",
    video: "فيديو",
    audio: "صوت",
    usable: "صالحة",
  },
};

function mediaTypeLabel(strings: typeof creatorCopy.en, mediaType: string) {
  if (mediaType === "image") return strings.image;
  if (mediaType === "video") return strings.video;
  if (mediaType === "audio") return strings.audio;
  return mediaType;
}

function mediaPreviewUrl(asset: MediaLibraryAsset) {
  return withMediaAccessToken(asset.previewUrl || `/api/v2/media/uploads/${asset.filename}`);
}

const defaultConfig: RenderConfig = {
  paddingBack: 1500,
  music: MusicMoodEnum.chill,
  captionPosition: CaptionPositionEnum.bottom,
  captionBackgroundColor: "rgba(11, 27, 31, 0.84)",
  voice: VoiceEnum.af_heart,
  orientation: OrientationEnum.portrait,
  musicVolume: MusicVolumeEnum.high,
  brandKit: {
    brandName: "Short Studio Demo",
    watermarkText: "Short Studio",
    primaryColor: "#24545a",
    accentColor: "#d28b4c",
    captionStyle: "bold",
    includeOutro: true,
    outroText: "Message us to start",
    contactText: "WhatsApp / Instagram",
  },
};

const templateSteps = ["Template", "Content", "Brand", "Settings", "Review"];

function fieldGridSize(field: BusinessTemplateField) {
  return field.type === "textarea" ? 12 : 6;
}

/**
 * Describes the voice the canonical spec actually resolved, using only what the
 * server reported. Nothing is inferred locally, so the badge cannot disagree
 * with the spec that will be rendered.
 */
function resolvedVoiceLabel(spec: any): string {
  const contract = spec?.metadata?.uiContract || {};
  const provider = contract.resolvedVoiceProvider || spec?.voiceProvider;
  if (!provider) return "";
  const parts = [provider === "elevenlabs" ? "ElevenLabs" : provider];
  if (contract.voiceName) parts.push(contract.voiceName);
  const preset = contract.voicePreset || spec?.voicePreset;
  if (preset) parts.push(String(preset).replaceAll("_", " "));
  return parts.join(" · ");
}

/**
 * A usage-based provider such as ElevenLabs must never be presented as a $0
 * external cost, and the engine does not invent a dollar figure it cannot
 * calculate reliably. Shared with Video Details so both screens agree.
 */
function costLabel(costEstimate: CostEstimateData | null): string {
  return externalCostLabel(costEstimate as any);
}

const VideoCreator: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { locale, t } = useI18n();
  const ui = creatorCopy[locale === "ar" ? "ar" : "en"];

  // Mode Selection: "prompt" vs "template"
  const [mode, setMode] = useState<"prompt" | "template">("prompt");

  // Prompt Mode States
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("auto");
  const [dialect, setDialect] = useState("egyptian");
  const [duration, setDuration] = useState(30);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [quality, setQuality] = useState("standard");
  const [resolution, setResolution] = useState("1080p");
  const [contentStyle, setContentStyle] = useState("advertisement");
  const [productionMode, setProductionMode] = useState("auto_hybrid");
  // Plain-language creative controls. These map onto the creative plan; the
  // internal treatment names and EDL stay out of the client surface.
  const [creativeStyle, setCreativeStyle] = useState("auto");
  const [animationIntensity, setAnimationIntensity] = useState<"low" | "balanced" | "high">("balanced");
  // Simple is the default: a customer should be able to produce a video from a
  // prompt and a handful of obvious choices. Advanced reveals the full control
  // surface without changing any underlying contract.
  const [uiMode, setUiMode] = useState<"simple" | "advanced">("simple");
  const [videoTypeId, setVideoTypeId] = useState<string>("auto");

  /** Applies the friendly type's canonical mode and companion defaults. */
  function applyVideoType(nextId: string) {
    const entry = videoTypeById(nextId);
    if (!entry) return;
    setVideoTypeId(nextId);
    setProductionMode(entry.mode);
    if (entry.suggestedVisualMode) {
      setVisualMode(entry.suggestedVisualMode as any);
      if (entry.suggestedVisualMode === "stock") setVisualSource("stock");
      else if (entry.suggestedVisualMode === "uploaded_media") setVisualSource("uploaded_media");
      else if (entry.suggestedVisualMode === "ai") setVisualSource("ai_generated");
      else if (entry.suggestedVisualMode === "hybrid") setVisualSource("mixed");
      else if (entry.suggestedVisualMode === "auto") setVisualSource("auto_best");
    }
    if (entry.suggestedCaptionStyle) setCaptionStyle(entry.suggestedCaptionStyle as any);
  }
  const [visualMode, setVisualMode] = useState("auto");
  const [visualSource, setVisualSource] = useState<"auto_free" | "auto_best" | "auto_budget" | "stock" | "uploaded_media" | "ai_generated" | "mixed">("auto_best");
  const [budgetMode, setBudgetMode] = useState<"free_only" | "smart_budget" | "best_available">("free_only");
  const [maxExternalSpendUsd, setMaxExternalSpendUsd] = useState(1);
  const [stockProvider, setStockProvider] = useState<"auto_stock" | "pexels" | "pixabay">("auto_stock");
  const [mediaPolicy, setMediaPolicy] = useState<"auto_use_selected" | "only_selected">("auto_use_selected");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [characterProfiles, setCharacterProfiles] = useState<any[]>([]);
  const [selectedCharacterProfileId, setSelectedCharacterProfileId] = useState("");
  const [aiVisualProvider, setAiVisualProvider] = useState("auto");
  const [voiceProvider, setVoiceProvider] = useState("auto");
  const [voiceId, setVoiceId] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [resolvedVoiceProvider, setResolvedVoiceProvider] = useState<string>("auto");
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);
  const [arabicVoiceBlocked, setArabicVoiceBlocked] = useState(false);
  const [arabicVoiceBlockedReasonCode, setArabicVoiceBlockedReasonCode] = useState<string | null>(null);
  const [captionEnabled, setCaptionEnabled] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<string>("social_ad");

  // Enhancement & Preview states
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceDialog, setEnhanceDialog] = useState(false);
  const [enhanceResult, setEnhanceResult] = useState<PromptEnhanceResult | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewSpec, setPreviewSpec] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimateData | null>(null);
  const [previewReadiness, setPreviewReadiness] = useState<any>(null);
  const [voicePreviewing, setVoicePreviewing] = useState(false);
  const [voicePreview, setVoicePreview] = useState<any>(null);
  const [providers, setProviders] = useState<ProviderItem[]>([]);

  // Template Mode States
  const [templateStep, setTemplateStep] = useState(0);
  const [templates, setTemplates] = useState<BusinessTemplateOption[]>([]);
  const [brands, setBrands] = useState<V2Brand[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [templateData, setTemplateData] = useState<Record<string, string>>({});
  const [scenes, setScenes] = useState<SceneFormData[]>([
    { text: "A concise video narration for a local business.", searchTerms: "business, retail, customer" },
  ]);
  const [config, setConfig] = useState<RenderConfig>(defaultConfig);
  const [saveTemplateDialog, setSaveTemplateDialog] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDescription, setSaveTemplateDescription] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Product Media & Readiness states
  const [selectedProductMediaId, setSelectedProductMediaId] = useState<string>("");
  const [mediaAssets, setMediaAssets] = useState<MediaLibraryAsset[]>([]);
  const [productHeadline, setProductHeadline] = useState("عرض حصري لفترة محدودة");
  const [productOffer, setProductOffer] = useState("خصم 25%");
  const [productPrice, setProductPrice] = useState("");
  const [productCta, setProductCta] = useState("اطلب الآن عبر واتساب");
  const [productPlacement, setProductPlacement] = useState<"center" | "left" | "right">("center");
  const [uploadingProduct, setUploadingProduct] = useState(false);
  const [modeReadiness, setModeReadiness] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      axios.get("/api/v2/templates"),
      axios.get("/api/v2/brands"),
      axios.get("/api/v2/settings"),
      axios.get("/api/v2/providers").catch(() => ({ data: { providers: [] } })),
      axios.get("/api/v2/media/characters").catch(() => ({ data: { characters: [] } })),
    ])
      .then(([templateResponse, brandResponse, settingsResponse, providerResponse, characterResponse]) => {
        const nextTemplates = templateResponse.data.templates || [];
        const nextBrands = brandResponse.data.brands || [];
        const appSettings = settingsResponse.data.settings || {};

        setTemplates(nextTemplates);
        setBrands(nextBrands);
        setProviders(providerResponse.data.providers || []);
        setCharacterProfiles(characterResponse.data.characters || []);
        const queryCharacter = params.get("character");
        if (queryCharacter && (characterResponse.data.characters || []).some((profile: any) => profile.id === queryCharacter)) {
          setSelectedCharacterProfileId(queryCharacter);
        }

        // Apply settings defaults if present
        if (appSettings.defaultCreationMode === "template") {
          setMode("template");
        }
        if (appSettings.defaultLanguage) setLanguage(appSettings.defaultLanguage);
        if (appSettings.defaultArabicDialect) setDialect(appSettings.defaultArabicDialect);
        if (appSettings.defaultDuration) setDuration(appSettings.defaultDuration);
        if (appSettings.defaultAspectRatio) setAspectRatio(appSettings.defaultAspectRatio);
        if (appSettings.defaultQuality) setQuality(appSettings.defaultQuality);
        if (appSettings.defaultVisualMode) setVisualMode(appSettings.defaultVisualMode);

        const queryTemplate = params.get("template");
        let templateBrandId = "";
        if (queryTemplate) {
          setMode("template");
          setSelectedTemplateId(queryTemplate);
          const template = nextTemplates.find((item: BusinessTemplateOption) => item.id === queryTemplate);
          if (template) {
            applyTemplateDefaults(template);
            templateBrandId = template.config?.brandId || "";
          }
        } else {
          const fallbackTemplate = nextTemplates.find((item: BusinessTemplateOption) => item.id === appSettings.defaultTemplateId) || nextTemplates[0];
          setSelectedTemplateId(fallbackTemplate?.id || "");
          if (fallbackTemplate) {
            applyTemplateDefaults(fallbackTemplate);
            templateBrandId = fallbackTemplate.config?.brandId || "";
          }
        }

        const queryBrand = params.get("brand");
        const defaultBrand =
          nextBrands.find((b: V2Brand) => b.id === queryBrand) ||
          nextBrands.find((b: V2Brand) => b.id === templateBrandId) ||
          nextBrands.find((b: V2Brand) => b.id === appSettings.defaultBrandId) ||
          nextBrands.find((b: V2Brand) => b.isDefault) ||
          nextBrands[0];

        if (defaultBrand) applyBrand(defaultBrand);
      })
      .catch(() => setError("Failed to load V2 templates or configuration."))
      .finally(() => setLoading(false));

    axios.get("/api/v2/media/assets").then((res) => {
      const assets: MediaLibraryAsset[] = res.data.assets || [];
      setMediaAssets(assets);
      // A 1x1 placeholder is a structurally valid PNG and used to be offered as
      // a product photo, and auto-selected because it happened to be first. Only
      // an asset the library reports as usable may be chosen.
      const firstUsable = assets.find((asset) => asset.usability?.usableForProduct || (asset.mediaType === "image" && asset.usable !== false));
      if (firstUsable && !selectedProductMediaId) {
        setSelectedProductMediaId(firstUsable.id);
      }
    }).catch(() => {});
  }, [params]);

  useEffect(() => {
    axios
      .get("/api/v2/system/readiness", {
        params: {
          mode: productionMode,
          visualMode,
          visualSource,
          stockProvider,
          mediaPolicy,
          aiVisualProvider,
          selectedMediaIds: selectedMediaIds.join(","),
          characterProfileId: selectedCharacterProfileId,
          language,
          dialect: language === "ar" || language === "auto" ? dialect : "none",
          captionEnabled,
        },
      })
      .then((res) => {
        setModeReadiness(res.data);
      })
      .catch(() => {});
  }, [productionMode, visualMode, visualSource, stockProvider, mediaPolicy, aiVisualProvider, selectedMediaIds, selectedCharacterProfileId, language, dialect, captionEnabled]);

  async function handleProductFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProduct(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const res = await axios.post("/api/v2/media/product-upload", {
            imageBase64: base64,
            filename: file.name,
            removeBackground: true,
          });
          const newMedia = res.data.media;
          setSelectedProductMediaId(newMedia.id);
          axios.get("/api/v2/media/assets").then((assetRes) => setMediaAssets(assetRes.data.assets || [])).catch(() => undefined);
        } catch (uploadErr: any) {
          setError(uploadErr?.response?.data?.error || "Product image upload failed.");
        } finally {
          setUploadingProduct(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadingProduct(false);
    }
  }

  useEffect(() => {
    axios
      .get("/api/v2/voices", {
        params: {
          provider: voiceProvider,
          language,
          dialect: language === "ar" || language === "auto" ? dialect : "none",
        },
      })
      .then((response) => {
        const nextVoices: VoiceOption[] = response.data.voices || [];
        setVoiceOptions(nextVoices);
        setResolvedVoiceProvider(response.data.resolvedProvider || voiceProvider);
        setVoiceWarnings(response.data.warnings || []);
        setArabicVoiceBlocked(Boolean(response.data.blocked));
        setArabicVoiceBlockedReasonCode(response.data.blockedReasonCode || null);
        // Auto-select deliberately stays empty. An empty voice ID is what lets
        // the server apply the persisted human default from the Voice Lab;
        // pinning the first voice in the account list would send an explicit
        // choice nobody made and quietly bypass that default.
        if (voiceId && !nextVoices.some((voice) => voice.id === voiceId)) {
          setVoiceId("");
        }
      })
      .catch(() => {
        setVoiceOptions([]);
        setVoiceWarnings(["Voice compatibility lookup failed."]);
      });
  }, [language, dialect, voiceProvider, voiceId]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const generatedScenes = useMemo(() => {
    if (!selectedTemplate) return [];
    if (!selectedTemplate.builtIn && selectedTemplate.config?.promptGuidance) {
      const text = applyTemplateText(selectedTemplate.config.promptGuidance, templateData);
      return [{ text, searchTerms: selectedTemplate.pexelsSearchHints || [] }];
    }
    return generateScenesForTemplate(selectedTemplate.id as BusinessTemplateId, templateData);
  }, [selectedTemplate, templateData]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const searchHints = selectedTemplate.pexelsSearchHints.join(", ");
    const nextScenes = (generatedScenes.length
      ? generatedScenes
      : [{ text: "Complete the required fields to generate template narration.", searchTerms: selectedTemplate.pexelsSearchHints }]
    ).map((scene) => ({
      text: scene.text,
      searchTerms: (scene.searchTerms?.length ? scene.searchTerms : selectedTemplate.pexelsSearchHints).join(", ") || searchHints,
    }));
    setScenes(nextScenes);
  }, [selectedTemplate, generatedScenes]);

  function applyBrand(brand: V2Brand) {
    setSelectedBrandId(brand.id);
    if (brand.defaultDurationSeconds) setDuration(brand.defaultDurationSeconds);
    if (brand.defaultQuality) setQuality(brand.defaultQuality);
    if (brand.defaultVisualSource) setVisualSource(brand.defaultVisualSource as any);
    if (brand.captionStyle) setCaptionStyle(brand.captionStyle);
    if (brand.defaultLanguage) setLanguage(brand.defaultLanguage);
    if (brand.defaultCharacterProfileId) setSelectedCharacterProfileId(brand.defaultCharacterProfileId);
    setConfig((prev) => ({
      ...prev,
      brandKit: {
        brandName: brand.name,
        watermarkText: brand.watermarkText || brand.name,
        primaryColor: brand.primaryColor || "#24545a",
        // Only forwarded when the brand really carries them; an absent field
        // stays undefined so the style resolver derives a neutral instead of
        // presenting an engine default as the customer's choice.
        secondaryColor: brand.secondaryColor || undefined,
        accentColor: brand.accentColor || "#d28b4c",
        logoUrl: brand.logoUrl || undefined,
        websiteUrl: brand.websiteUrl || undefined,
        socialHandle: brand.socialHandle || undefined,
        // A brand set to "none" has no caption-style override to contribute;
        // the production spec's own captionStyle governs that case.
        captionStyle: (brand.captionStyle && brand.captionStyle !== "none" ? brand.captionStyle : "bold") as any,
        includeOutro: brand.includeOutro ?? true,
        outroText: brand.outroText || "",
        contactText: brand.contactText || "",
      },
    }));
  }

  function applyTemplateDefaults(template: BusinessTemplateOption) {
    setSelectedTemplateId(template.id);
    const defaults = template.config || {};
    const durationSeconds = Number(defaults.durationSeconds || template.targetDurationSeconds || template.suggestedDurationSeconds || 0);
    if (durationSeconds > 0) setDuration(durationSeconds);
    if (defaults.aspectRatio) setAspectRatio(String(defaults.aspectRatio));
    if (defaults.quality) setQuality(String(defaults.quality));
    if (defaults.visualSource) setVisualSource(String(defaults.visualSource) as any);
    if (defaults.mediaPolicy) setMediaPolicy(String(defaults.mediaPolicy) as any);
    if (defaults.captionStyle) setCaptionStyle(String(defaults.captionStyle));
    if (defaults.productionMode) setProductionMode(String(defaults.productionMode));
    if (defaults.contentStyle) setContentStyle(String(defaults.contentStyle));
    if (defaults.creativeStyle) setCreativeStyle(String(defaults.creativeStyle));
    if (Array.isArray(defaults.selectedMediaIds)) setSelectedMediaIds(defaults.selectedMediaIds.map(String));
    if (defaults.characterProfileId) setSelectedCharacterProfileId(String(defaults.characterProfileId));
    if (defaults.brandId) {
      const brand = brands.find((item) => item.id === defaults.brandId);
      if (brand) applyBrand(brand);
      else setSelectedBrandId(String(defaults.brandId));
    }
    const seeded = Object.fromEntries(
      (template.fields || [])
        .map((field) => [field.key, templateData[field.key] || ""])
        .filter(([key]) => Boolean(key)),
    );
    setTemplateData(seeded);
  }

  function applyTemplateText(text: string, values: Record<string, string>) {
    return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key) => values[key] || "");
  }

  function updateBrandKit(field: keyof NonNullable<RenderConfig["brandKit"]>, value: string | boolean) {
    setConfig((prev) => ({
      ...prev,
      brandKit: { ...prev.brandKit, [field]: value },
    }));
  }

  // The library reports usability per asset; the creator only ever offers the
  // assets that can actually appear in a video.
  const selectableMediaAssets = useMemo(
    () => mediaAssets.filter((asset) => asset?.usability?.usableForVideo || asset?.usable !== false),
    [mediaAssets],
  );
  const unusableMediaAssets = useMemo(
    () => mediaAssets.filter((asset) => !(asset?.usability?.usableForVideo || asset?.usable !== false)),
    [mediaAssets],
  );
  const productCapableAssets = useMemo(
    () => selectableMediaAssets.filter((asset) => asset.mediaType === "image" && (asset.usability?.usableForProduct || asset.usable !== false)),
    [selectableMediaAssets],
  );

  // A video type or an older job can carry a style the curated list folds into
  // another entry. Keeping it selectable shows the real value instead of blank.
  const captionStyleChoices = useMemo(
    () =>
      CAPTION_STYLES.some((style) => style.id === captionStyle)
        ? CAPTION_STYLES
        : [...CAPTION_STYLES, { id: captionStyle, label: CAPTION_STYLE_LABELS[captionStyle] || captionStyle }],
    [captionStyle],
  );

  // A default duration saved before this list changed must still render, so
  // an off-list value joins the choices instead of blanking the Select.
  const durationChoices = useMemo(
    () =>
      DURATION_OPTIONS.includes(duration)
        ? DURATION_OPTIONS
        : [...DURATION_OPTIONS, duration].sort((a, b) => a - b),
    [duration],
  );

  const configuredStockProviders = useMemo(
    () => providers.filter((provider) => provider.category === "Visuals" && provider.tier === "stock" && provider.configured !== false),
    [providers],
  );
  const aiVideoProviders = useMemo(
    () => providers.filter((provider) => provider.category === "Visuals" && (provider.tier === "ai_video" || provider.id === "comfyui")),
    [providers],
  );
  const configuredAiVideoProviders = useMemo(
    () => aiVideoProviders.filter((provider) => provider.configured !== false),
    [aiVideoProviders],
  );

  function toggleSelectedMedia(id: string) {
    setSelectedMediaIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function selectMediaAsset(asset: MediaLibraryAsset) {
    const wasSelected = selectedMediaIds.includes(asset.id);
    toggleSelectedMedia(asset.id);
    if (wasSelected && selectedProductMediaId === asset.id) {
      setSelectedProductMediaId("");
      return;
    }
    if (asset.mediaType === "image" && (asset.usability?.usableForProduct || asset.usable !== false)) {
      setSelectedProductMediaId(asset.id);
    }
  }

  function readinessMessage(): string | null {
    if (!prompt.trim()) return t("create.readiness.writePrompt");
    if (arabicBlocked) return t("create.readiness.arabicLocalVoiceRequired");
    if (selectedProviderUnavailable) return t("create.readiness.providerNotConfigured");
    if (modeReadiness && !modeReadiness.ready) {
      return modeReadiness.missingRequirements?.[0] || t("create.readiness.setupNotRunnable");
    }
    return null;
  }

  const selectedVoiceProvider = useMemo(() => {
    if (voiceProvider === "auto") return null;
    return providers.find(
      (provider) =>
        provider.id === voiceProvider ||
        provider.name.toLowerCase().includes(voiceProvider.replaceAll("_", " ")),
    );
  }, [providers, voiceProvider]);

  const selectedProviderUnavailable = Boolean(
    voiceProvider !== "auto" &&
      selectedVoiceProvider &&
      selectedVoiceProvider.configured === false,
  );

  const isArabicMode = language === "ar" || (language === "auto" && dialect !== "none");
  const selectedVoice = voiceOptions.find((voice) => voice.id === voiceId);

  // Arabic / Egyptian / MSA narration is local-first (VoiceTut, then KemeTone);
  // `arabicVoiceBlocked` mirrors the server's real routing decision (which already
  // accounts for local voice readiness and an explicit ElevenLabs premium
  // selection), so it alone determines whether the form blocks submission -
  // ElevenLabs configuration is never required on its own.
  const arabicBlocked = Boolean(isArabicMode && arabicVoiceBlocked);

  function arabicBlockedMessage(): string {
    return arabicVoiceBlockedReasonCode === "elevenlabs_not_configured"
      ? t("create.voiceGuidance.elevenlabsNotConfigured")
      : t("create.voiceGuidance.localVoiceSetupRequired");
  }

  function arabicBlockedActionLabel(): string {
    return arabicVoiceBlockedReasonCode === "elevenlabs_not_configured"
      ? t("create.voiceGuidance.configureElevenlabs")
      : t("create.voiceGuidance.openLocalVoiceSetup");
  }

  function voiceProviderGuidance(): string {
    if (isArabicMode) {
      return t("create.voiceGuidance.arabic");
    }
    if (voiceProvider === "piper") return "Piper is legacy only. It stays available so historical videos remain readable and is not used for new production.";
    if (voiceProvider === "edge_tts") return "Edge TTS is experimental, online, and disabled by default. It is never a production Arabic route.";
    if (voiceProvider === "google_cloud_tts") return "Google Cloud TTS remains integrated for manual use. It is not part of the standard Arabic production path.";
    if (voiceProvider === "kokoro") return "Kokoro is the local/free English path and remains the default for English production.";
    if (voiceProvider === "elevenlabs") return "ElevenLabs runs when credentials are configured. Cost is usage based on your ElevenLabs plan.";
    return `Auto resolves to ${resolvedVoiceProvider === "kokoro" ? "Kokoro English" : resolvedVoiceProvider} for the chosen language.`;
  }

  async function handleEnhancePrompt() {
    if (!prompt.trim()) return;
    setEnhancing(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/prompt/enhance", {
        prompt,
        language: language !== "auto" ? language : undefined,
        dialect: dialect !== "none" ? dialect : undefined,
        contentStyle,
      });
      setEnhanceResult(response.data);
      setEnhanceDialog(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Prompt enhancement failed.");
    } finally {
      setEnhancing(false);
    }
  }

  function acceptEnhancedPrompt() {
    if (enhanceResult?.enhancedPrompt) {
      setPrompt(enhanceResult.enhancedPrompt);
    }
    setEnhanceDialog(false);
  }

  async function handlePreviewSpec() {
    if (!prompt.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/production-spec/preview", {
        prompt,
        language,
        dialect: language === "ar" || language === "auto" ? dialect : "none",
        durationSeconds: duration,
        aspectRatio,
        quality,
        resolution,
        contentStyle,
        visualMode,
        visualSource,
        budgetMode,
        maxExternalSpendUsd: budgetMode === "smart_budget" ? maxExternalSpendUsd : undefined,
        stockProvider,
        mediaPolicy,
        selectedMediaIds,
        characterProfileId: selectedCharacterProfileId || undefined,
        aiVisualProvider,
        voiceProvider,
        voiceId,
        captionEnabled,
        captionStyle,
        productionMode,
        creativeStyle,
        animationIntensity,
        brandId: selectedBrandId || undefined,
        brandName: config.brandKit?.brandName,
      });
      setPreviewSpec(response.data.spec);
      setCostEstimate(response.data.costEstimate);
      setPreviewReadiness(response.data.readiness || null);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Production spec preview failed.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleVoicePreview() {
    const sampleText = (previewSpec?.scenes?.[0]?.narration || prompt).trim().slice(0, 360);
    if (!sampleText) return;
    setVoicePreviewing(true);
    setVoicePreview(null);
    setError(null);
    try {
      const response = await axios.post("/api/voice-preview", {
        text: sampleText,
        language,
        dialect: language === "ar" || language === "auto" ? dialect : "none",
        qualityProfile: quality === "premium" || quality === "high" ? "premium" : quality === "draft" ? "fast" : "balanced",
        provider: voiceProvider,
        voiceId: voiceId || undefined,
      });
      setVoicePreview(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Voice preview failed.");
    } finally {
      setVoicePreviewing(false);
    }
  }

  async function submitPromptJob() {
    if (!prompt.trim()) {
      setError("Please write a video prompt.");
      return;
    }
    if (arabicBlocked) {
      setError(arabicBlockedMessage());
      return;
    }
    if (selectedProviderUnavailable) {
      setError("The selected voice provider is not configured. Choose a local provider or configure it in Providers first.");
      return;
    }
    const blockedReason = readinessMessage();
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await axios.post(
        "/api/v2/jobs",
        {
          creationMode: "prompt",
          prompt,
          language,
          dialect: language === "ar" || language === "auto" ? dialect : "none",
          durationSeconds: duration,
          aspectRatio,
          quality,
          resolution,
          contentStyle,
          productionMode,
          creativeStyle,
          animationIntensity,
          visualMode,
          visualSource,
          budgetMode,
          maxExternalSpendUsd: budgetMode === "smart_budget" ? maxExternalSpendUsd : undefined,
          stockProvider,
          mediaPolicy,
          selectedMediaIds,
          characterProfileId: selectedCharacterProfileId || undefined,
          aiVisualProvider,
          voiceProvider,
          voiceId,
          captionEnabled,
          captionStyle,
          brandId: selectedBrandId || undefined,
          brandName: config.brandKit?.brandName,
          productionSpec: previewSpec || undefined,
          metadata: {
            productImageId: selectedProductMediaId || undefined,
            productHeadline,
            productOffer,
            productPrice,
            productCta,
            productPlacement,
            selectedMediaIds,
            characterProfileId: selectedCharacterProfileId || undefined,
            mediaPolicy,
            stockProvider,
            aiVisualProvider,
            budgetMode,
            maxExternalSpendUsd: budgetMode === "smart_budget" ? maxExternalSpendUsd : undefined,
          },
        },
        {
          headers: {
            "Idempotency-Key": `create-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
          },
        },
      );
      navigate(`/jobs/${response.data.job.id}`);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Failed to create Prompt Mode video job.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function saveCurrentAsTemplate() {
    const name = saveTemplateName.trim();
    if (!name) {
      setError("Template name is required.");
      return;
    }
    try {
      await axios.post("/api/v2/templates", {
        name,
        description: saveTemplateDescription.trim(),
        category: videoTypeId === "product_ad" ? "product" : contentStyle === "educational" ? "educational" : "social",
        favorite: true,
        config: {
          productionMode,
          contentStyle,
          creativeStyle,
          durationSeconds: duration,
          aspectRatio,
          quality,
          visualSource,
          mediaPolicy,
          captionStyle,
          brandId: selectedBrandId || undefined,
          characterProfileId: selectedCharacterProfileId || undefined,
          selectedMediaIds,
          promptGuidance: prompt || selectedTemplate?.examplePrompt || "",
        },
        variables: selectedTemplate?.variables || selectedTemplate?.fields?.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type === "number" || field.type === "date" || field.type === "url" || field.type === "media_asset" ? field.type : "text",
          required: field.required,
          example: field.placeholder,
          helpText: field.helperText,
        })) || [],
      });
      setSaveTemplateDialog(false);
      setSaveTemplateName("");
      setSaveTemplateDescription("");
      const response = await axios.get("/api/v2/templates");
      setTemplates(response.data.templates || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Template could not be saved.");
    }
  }

  async function submitTemplateJob() {
    if (!selectedTemplate) {
      setError("Choose a template before creating a video.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const businessTemplateData = Object.fromEntries(
        Object.entries(templateData).filter(([, value]) => value.trim().length > 0),
      );
      if (selectedTemplate.custom) {
        const resolved = await axios.post(`/api/v2/templates/${selectedTemplate.id}/resolve`, {
          variables: businessTemplateData,
        });
        const resolvedConfig = resolved.data.resolvedConfig || {};
        const response = await axios.post(
          "/api/v2/jobs",
          {
            creationMode: "prompt",
            title: `${config.brandKit?.brandName || "Video"} · ${selectedTemplate.displayName}`,
            prompt: resolvedConfig.promptGuidance || selectedTemplate.examplePrompt || selectedTemplate.description,
            language,
            dialect: language === "ar" || language === "auto" ? dialect : "none",
            durationSeconds: Number(resolvedConfig.durationSeconds || duration),
            aspectRatio: resolvedConfig.aspectRatio || aspectRatio,
            quality: resolvedConfig.quality || quality,
            resolution,
            contentStyle: resolvedConfig.contentStyle || contentStyle,
            productionMode: resolvedConfig.productionMode || productionMode,
            creativeStyle: resolvedConfig.creativeStyle || creativeStyle,
            animationIntensity,
            visualMode,
            visualSource: resolvedConfig.visualSource || visualSource,
            stockProvider,
            mediaPolicy: resolvedConfig.mediaPolicy || mediaPolicy,
            selectedMediaIds: Array.isArray(resolvedConfig.selectedMediaIds) ? resolvedConfig.selectedMediaIds : selectedMediaIds,
            characterProfileId: resolvedConfig.characterProfileId || selectedCharacterProfileId || undefined,
            aiVisualProvider,
            voiceProvider,
            voiceId,
            captionEnabled,
            captionStyle: resolvedConfig.captionStyle || captionStyle,
            brandId: resolvedConfig.brandId || selectedBrandId || undefined,
            templateId: selectedTemplate.id,
            templateVariables: businessTemplateData,
            metadata: {
              templateVariables: businessTemplateData,
              selectedMediaIds,
              characterProfileId: resolvedConfig.characterProfileId || selectedCharacterProfileId || undefined,
              mediaPolicy: resolvedConfig.mediaPolicy || mediaPolicy,
              stockProvider,
              aiVisualProvider,
            },
          },
          {
            headers: {
              "Idempotency-Key": `template-${selectedTemplate.id}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
            },
          },
        );
        navigate(`/jobs/${response.data.job.id}`);
        return;
      }
      const apiScenes: SceneInput[] = scenes.map((scene) => ({
        text: scene.text,
        searchTerms: scene.searchTerms
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean),
      }));
      const title = `${config.brandKit?.brandName || "Video"} · ${selectedTemplate?.displayName || "Manual"}`;
      const response = await axios.post("/api/v2/jobs", {
        type: "video",
        creationMode: "template",
        title,
        scenes: apiScenes,
        config,
        businessTemplateId: selectedTemplateId || undefined,
        businessTemplateData: selectedTemplateId ? businessTemplateData : undefined,
        templateVariables: selectedTemplateId ? businessTemplateData : undefined,
        brandId: selectedBrandId || undefined,
      });
      navigate(`/jobs/${response.data.job.id}`);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Video job could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading Video Studio..." />;

  return (
    <>
      <PageHeader
        title="Create Video"
        eyebrow="Production Studio"
        description="Start with a prompt, choose the essential video settings, preview the voice, then create a production job."
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<SaveIcon />} onClick={() => {
              setSaveTemplateName(prompt ? prompt.slice(0, 54) : selectedTemplate?.displayName ? `${selectedTemplate.displayName} Custom` : "");
              setSaveTemplateDescription(selectedTemplate?.description || "");
              setSaveTemplateDialog(true);
            }}>
              Save as Template
            </Button>
            <ButtonGroup variant="contained">
              <Button
                color={mode === "prompt" ? "primary" : "inherit"}
                variant={mode === "prompt" ? "contained" : "outlined"}
                onClick={() => setMode("prompt")}
              >
                Prompt Mode
              </Button>
              <Button
                color={mode === "template" ? "primary" : "inherit"}
                variant={mode === "template" ? "contained" : "outlined"}
                onClick={() => setMode("template")}
              >
                Template Mode
              </Button>
            </ButtonGroup>
          </Stack>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ========================================================================= */}
      {/* PROMPT MODE (DEFAULT & FIRST-CLASS EXPERIENCE)                           */}
      {/* ========================================================================= */}
      {mode === "prompt" && (
        <Stack spacing={3}>
          <SectionCard
            title="What do you want to create?"
            description="A prompt is enough. The engine will resolve the type, visuals, voice, captions and providers automatically unless you choose otherwise."
            actions={
              <Stack direction="row" spacing={1}>
                {prompt.length > 0 && (
                  <Button
                    size="small"
                    startIcon={<ClearIcon />}
                    onClick={() => setPrompt("")}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AutoAwesomeIcon />}
                  disabled={enhancing || !prompt.trim()}
                  onClick={handleEnhancePrompt}
                >
                  {enhancing ? "Enhancing..." : "Improve Prompt"}
                </Button>
              </Stack>
            }
          >
            <Stack spacing={1.5}>
              <TextField
                fullWidth
                multiline
                minRows={4}
                maxRows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to create. Include the subject, audience, style, goal, offer, language, and anything important."
                helperText={`${prompt.length} / 4000 characters`}
              />

              {/* Example Prompts */}
              <Typography variant="caption" color="text.secondary" fontWeight={700}>
                Example Ideas (click to populate):
              </Typography>
              <Grid container spacing={1.5}>
                {EXAMPLE_PROMPTS.map((ex, idx) => (
                  <Grid item xs={12} sm={6} md={4} key={idx}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: "100%",
                        bgcolor: "background.paper",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    >
                      <CardActionArea
                        sx={{ p: 1.5, height: "100%", alignItems: "flex-start" }}
                        onClick={() => setPrompt(ex.prompt)}
                      >
                        <Stack spacing={0.5}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" fontWeight={800} noWrap>
                              {ex.title}
                            </Typography>
                            <Chip size="small" label={ex.tag} sx={{ fontSize: 10 }} />
                          </Stack>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              fontSize: 12,
                            }}
                          >
                            {ex.prompt}
                          </Typography>
                        </Stack>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Stack>
          </SectionCard>

          {/* Video type: friendly labels over the canonical production modes. */}
          <SectionCard
            title="Video type (optional)"
            description="Auto lets the Creative Director infer the right treatment from the prompt and available capabilities."
          >
            <Grid container spacing={1.5}>
              {VIDEO_TYPES.map((entry) => {
                const selected = videoTypeId === entry.id;
                return (
                  <Grid item xs={12} sm={6} md={3} key={entry.id}>
                    <Card
                      onClick={() => applyVideoType(entry.id)}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          applyVideoType(entry.id);
                        }
                      }}
                      sx={{
                        p: 1.75,
                        height: "100%",
                        cursor: "pointer",
                        borderColor: selected ? "primary.main" : "divider",
                        bgcolor: selected ? "action.selected" : "transparent",
                        transition: "border-color 120ms, background-color 120ms",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    >
                      <Typography variant="body2" fontWeight={650}>
                        {entry.label}{entry.id === "auto" ? " · Optional" : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        {entry.description}
                      </Typography>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </SectionCard>

          {/* Progressive Disclosure: Production Options */}
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ width: "100%", pr: 1 }}
              >
                <Typography variant="h6" fontWeight={700}>
                  Video settings
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={uiMode}
                  onChange={(event, next) => {
                    event.stopPropagation();
                    if (next) setUiMode(next);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Settings detail level"
                >
                  <ToggleButton value="simple" aria-label="Simple settings">Simple</ToggleButton>
                  <ToggleButton value="advanced" aria-label="Advanced settings">Advanced</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                {/* Language */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="language-select-label">Language</InputLabel>
                    <Select labelId="language-select-label" id="language-select" label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <MenuItem value="auto">Auto Detect</MenuItem>
                      <MenuItem value="ar">Arabic (العربية)</MenuItem>
                      <MenuItem value="en">English</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Arabic Dialect */}
                {(language === "ar" || language === "auto") && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel id="dialect-select-label">Arabic Dialect</InputLabel>
                      <Select labelId="dialect-select-label" id="dialect-select" label="Arabic Dialect" value={dialect} onChange={(e) => setDialect(e.target.value)}>
                        <MenuItem value="egyptian">Egyptian Arabic (المصرية)</MenuItem>
                        <MenuItem value="msa">Modern Standard Arabic (الفصحى)</MenuItem>
                        <MenuItem value="saudi">Saudi Arabic (السعودية)</MenuItem>
                        <MenuItem value="gulf">Gulf Arabic (الخليجية)</MenuItem>
                        <MenuItem value="levantine">Levantine Arabic (الشامية)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {/* Duration */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="duration-select-label">Duration</InputLabel>
                    <Select labelId="duration-select-label" id="duration-select" label="Duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      {durationChoices.map((seconds) => (
                        <MenuItem key={seconds} value={seconds}>
                          {seconds}s
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {/* Aspect Ratio */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="aspect-ratio-select-label">Aspect Ratio</InputLabel>
                    <Select labelId="aspect-ratio-select-label" id="aspect-ratio-select" label="Aspect Ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                      <MenuItem value="9:16">9:16 - Shorts / Reels / TikTok</MenuItem>
                      <MenuItem value="16:9">16:9 - YouTube / Landscape</MenuItem>
                      <MenuItem value="1:1">1:1 - Square feed</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Captions */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="captions-enabled-select-label">Captions</InputLabel>
                    <Select
                      labelId="captions-enabled-select-label"
                      id="captions-enabled-select"
                      label="Captions"
                      value={captionEnabled ? "on" : "off"}
                      onChange={(e) => setCaptionEnabled(e.target.value === "on")}
                    >
                      <MenuItem value="on">On</MenuItem>
                      <MenuItem value="off">Off</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Visual Source */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="visual-source-select-label">Visual Source</InputLabel>
                    <Select
                      labelId="visual-source-select-label"
                      id="visual-source-select"
                      label="Visual Source"
                      value={visualSource}
                      onChange={(e) => {
                        const next = e.target.value as typeof visualSource;
                        setVisualSource(next);
                        if (next === "stock") setVisualMode("stock");
                        else if (next === "uploaded_media") setVisualMode("uploaded_media");
                        else if (next === "ai_generated") setVisualMode("ai");
                        else if (next === "mixed") setVisualMode("hybrid");
                        else setVisualMode("auto");
                        if (next === "auto_free" || next === "stock" || next === "uploaded_media") setBudgetMode("free_only");
                        if (next === "auto_budget") setBudgetMode("smart_budget");
                        if (next === "ai_generated" || next === "mixed") setBudgetMode("best_available");
                      }}
                    >
                      <MenuItem value="auto_best">Auto Best</MenuItem>
                      <MenuItem value="auto_free">Auto Free</MenuItem>
                      <MenuItem value="auto_budget">Auto Budget</MenuItem>
                      <MenuItem value="stock">Stock</MenuItem>
                      <MenuItem value="uploaded_media">Uploaded Media</MenuItem>
                      <MenuItem value="ai_generated" disabled={configuredAiVideoProviders.length === 0}>
                        AI Generated{configuredAiVideoProviders.length === 0 ? " · Configure an AI Video Provider" : ""}
                      </MenuItem>
                      <MenuItem value="mixed">Mixed</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Budget */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="budget-mode-select-label">Budget</InputLabel>
                    <Select
                      labelId="budget-mode-select-label"
                      id="budget-mode-select"
                      label="Budget"
                      value={budgetMode}
                      onChange={(e) => {
                        const next = e.target.value as typeof budgetMode;
                        setBudgetMode(next);
                        if (next === "free_only") setVisualSource("auto_free");
                        if (next === "smart_budget") setVisualSource("auto_budget");
                        if (next === "best_available" && visualSource === "auto_free") setVisualSource("auto_best");
                      }}
                    >
                      <MenuItem value="free_only">Free Only</MenuItem>
                      <MenuItem value="smart_budget">Smart Budget</MenuItem>
                      <MenuItem value="best_available">Best Available</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {budgetMode === "smart_budget" && (
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Max external spend"
                      value={maxExternalSpendUsd}
                      onChange={(event) => setMaxExternalSpendUsd(Math.max(0, Number(event.target.value) || 0))}
                      inputProps={{ min: 0, max: 1000, step: 0.5 }}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                      }}
                    />
                  </Grid>
                )}

                {/* Production Mode */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="production-mode-select-label">Video Type</InputLabel>
                    <Select labelId="production-mode-select-label" id="production-mode-select" label="Video Type" value={productionMode} onChange={(e) => setProductionMode(e.target.value)}>
                      <MenuItem value="auto_hybrid">Auto</MenuItem>
                      <MenuItem value="stock_cinematic">Cinematic</MenuItem>
                      <MenuItem value="product_ad">Product Ad</MenuItem>
                      <MenuItem value="motion_graphics">Motion Graphics</MenuItem>
                      <MenuItem value="animated_explainer">Animated Explainer</MenuItem>
                      <MenuItem value="ai_generated">AI Generated</MenuItem>
                      <MenuItem value="social_viral">Social / Reel</MenuItem>
                      <MenuItem value="educational">Educational</MenuItem>
                      <MenuItem value="custom_media">Custom Media</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {/* Quality Profile */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="quality-select-label">Quality Profile</InputLabel>
                    <Select labelId="quality-select-label" id="quality-select" label="Quality Profile" value={quality} onChange={(e) => setQuality(e.target.value)}>
                      {QUALITY_OPTIONS.map((option) => (
                        <MenuItem key={option.id} value={option.id}>
                          {option.label} - {option.description}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {/* Resolution */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="resolution-select-label">Resolution</InputLabel>
                    <Select labelId="resolution-select-label" id="resolution-select" label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                      <MenuItem value="1080p">1080p (Full HD)</MenuItem>
                      <MenuItem value="720p">720p (HD)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {/* Content Style */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="content-style-select-label">Content Style</InputLabel>
                    <Select labelId="content-style-select-label" id="content-style-select" label="Content Style" value={contentStyle} onChange={(e) => setContentStyle(e.target.value)}>
                      <MenuItem value="advertisement">Advertisement</MenuItem>
                      <MenuItem value="ugc">UGC (User Generated)</MenuItem>
                      <MenuItem value="cinematic">Cinematic</MenuItem>
                      <MenuItem value="educational">Educational</MenuItem>
                      <MenuItem value="explainer">Explainer</MenuItem>
                      <MenuItem value="viral_curiosity">Viral / Curiosity</MenuItem>
                      <MenuItem value="product_showcase">Product Showcase</MenuItem>
                      <MenuItem value="social_short">Social Short</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {/* Creative Style. Plain-language names for the creative
                    presets; the treatment vocabulary behind them is internal and
                    never surfaced here. */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel id="creative-style-select-label">Creative Style</InputLabel>
                      <Select
                        labelId="creative-style-select-label"
                        id="creative-style-select"
                        label="Creative Style"
                        value={creativeStyle}
                        onChange={(e) => setCreativeStyle(e.target.value)}
                      >
                        <MenuItem value="auto">Auto (match the brief)</MenuItem>
                        <MenuItem value="clean_professional">Clean Professional</MenuItem>
                        <MenuItem value="viral_social">Viral Social</MenuItem>
                        <MenuItem value="cinematic">Cinematic</MenuItem>
                        <MenuItem value="motion_explainer">Motion Explainer</MenuItem>
                        <MenuItem value="product_showcase">Product Showcase</MenuItem>
                        <MenuItem value="tech_saas">Tech / SaaS</MenuItem>
                        <MenuItem value="educational">Educational</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {/* Animation Intensity. Scales how often the picture changes and
                    how strong the camera moves are. */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel id="animation-intensity-select-label">Animation Intensity</InputLabel>
                      <Select
                        labelId="animation-intensity-select-label"
                        id="animation-intensity-select"
                        label="Animation Intensity"
                        value={animationIntensity}
                        onChange={(e) => setAnimationIntensity(e.target.value as "low" | "balanced" | "high")}
                      >
                        <MenuItem value="low">Calm - fewer cuts, gentle moves</MenuItem>
                        <MenuItem value="balanced">Balanced</MenuItem>
                        <MenuItem value="high">Energetic - faster cuts, stronger moves</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {/* Visual Mode */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="visual-mode-select-label">Source Provider</InputLabel>
                    <Select labelId="visual-mode-select-label" id="visual-mode-select" label="Source Provider" value={visualMode} onChange={(e) => setVisualMode(e.target.value)}>
                      <MenuItem value="auto">Auto Provider</MenuItem>
                      <MenuItem value="stock">Stock</MenuItem>
                      <MenuItem value="uploaded_media">Uploaded Media</MenuItem>
                      <MenuItem value="motion_graphics">Motion Graphics</MenuItem>
                      <MenuItem value="animated_explainer">Animated Explainer</MenuItem>
                      <MenuItem value="product_ad">Product Composition</MenuItem>
                      <MenuItem value="image_animation">Image Animation</MenuItem>
                      <MenuItem value="hybrid">Mixed</MenuItem>
                      <MenuItem value="ai" disabled={configuredAiVideoProviders.length === 0}>
                        AI Generated{configuredAiVideoProviders.length === 0 ? " · Configure" : ""}
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {uiMode === "advanced" && ["stock", "auto_best", "auto_free", "auto_budget"].includes(visualSource) && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel id="stock-provider-select-label">Stock Provider</InputLabel>
                      <Select
                        labelId="stock-provider-select-label"
                        id="stock-provider-select"
                        label="Stock Provider"
                        value={stockProvider}
                        onChange={(e) => setStockProvider(e.target.value as typeof stockProvider)}
                      >
                        <MenuItem value="auto_stock">Auto Stock</MenuItem>
                        <MenuItem value="pexels" disabled={!providers.some((p) => p.id === "pexels" && p.configured !== false)}>
                          Pexels{providers.some((p) => p.id === "pexels" && p.configured !== false) ? " · Available" : " · Configure"}
                        </MenuItem>
                        <MenuItem value="pixabay" disabled={!providers.some((p) => p.id === "pixabay" && p.configured !== false)}>
                          Pixabay{providers.some((p) => p.id === "pixabay" && p.configured !== false) ? " · Available" : " · Configure"}
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {uiMode === "advanced" && visualSource === "ai_generated" && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel id="ai-provider-select-label">AI Visual Provider</InputLabel>
                      <Select
                        labelId="ai-provider-select-label"
                        id="ai-provider-select"
                        label="AI Visual Provider"
                        value={aiVisualProvider}
                        onChange={(e) => setAiVisualProvider(e.target.value)}
                      >
                        <MenuItem value="auto">Auto Provider</MenuItem>
                        {aiVideoProviders.map((provider) => (
                          <MenuItem key={provider.id} value={provider.id} disabled={provider.configured === false}>
                            {provider.name}{provider.configured === false ? " · Configure" : " · Available"}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {uiMode === "advanced" && (visualSource === "uploaded_media" || visualSource === "mixed") && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel id="media-policy-select-label">Media Selection</InputLabel>
                      <Select
                        labelId="media-policy-select-label"
                        id="media-policy-select"
                        label="Media Selection"
                        value={mediaPolicy}
                        onChange={(e) => setMediaPolicy(e.target.value as typeof mediaPolicy)}
                      >
                        <MenuItem value="auto_use_selected">Auto-use selected media</MenuItem>
                        <MenuItem value="only_selected">Use only selected media</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {/* Voice Provider */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="voice-provider-select-label">Voice Provider</InputLabel>
                    <Select
                      labelId="voice-provider-select-label"
                      id="voice-provider-select"
                      label="Voice Provider"
                      value={voiceProvider}
                      onChange={(e) => {
                        const nextProvider = e.target.value;
                        setVoiceProvider(nextProvider);
                        setVoiceId("");
                      }}
                    >
                      <MenuItem value="auto">
                        {isArabicMode ? "Auto - VoiceTut/KemeTone local voice" : "Auto - safest local provider"}
                      </MenuItem>
                      <MenuItem value="elevenlabs">ElevenLabs - Arabic production / multilingual</MenuItem>
                      <MenuItem value="kokoro" disabled={isArabicMode}>Kokoro - English local / free</MenuItem>
                      <MenuItem value="piper" disabled>Piper - legacy, historical jobs only</MenuItem>
                      <MenuItem value="edge_tts" disabled={isArabicMode}>Edge TTS - experimental, not for Arabic</MenuItem>
                      <MenuItem value="google_cloud_tts" disabled={isArabicMode}>Google Cloud TTS - manual use, not the Arabic route</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {/* Voice */}
                {uiMode === "advanced" && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="voice-select-label">Voice</InputLabel>
                    <Select labelId="voice-select-label" id="voice-select" label="Voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                      <MenuItem value="">Auto-select</MenuItem>
                      {voiceProvider === "google_cloud_tts" && voiceOptions.length === 0 && (
                        <MenuItem value="" disabled>
                          Configure Google credentials to load ar-XA voices
                        </MenuItem>
                      )}
                      {voiceOptions.map((voice) => (
                        <MenuItem key={`${voice.provider}-${voice.id}`} value={voice.id}>
                          {voice.name}
                          {voice.provider ? ` · ${voice.provider}` : ""}
                          {voice.voiceFamily ? ` · ${voice.voiceFamily}` : ""}
                          {voice.dialect ? ` · ${voice.dialect}` : ""}
                          {voice.gender ? ` · ${voice.gender}` : ""}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {/* Captions Style */}
                {captionEnabled && (
                  <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="captions-style-select-label">Caption Style</InputLabel>
                    <Select labelId="captions-style-select-label" id="captions-style-select" label="Captions Style" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as any)}>
                      {captionStyleChoices.map((style) => (
                        <MenuItem key={style.id} value={style.id}>{style.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                )}

                {/* Saved Brand */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="brand-profile-select-label">Brand Profile</InputLabel>
                    <Select
                      labelId="brand-profile-select-label"
                      id="brand-profile-select"
                      label="Brand Profile"
                      value={selectedBrandId}
                      onChange={(e) => {
                        const b = brands.find((item) => item.id === e.target.value);
                        if (b) applyBrand(b);
                      }}
                    >
                      <MenuItem value="">Custom / None</MenuItem>
                      {brands.map((b) => (
                        <MenuItem key={b.id} value={b.id}>
                          {b.name} {b.isDefault ? "(Default)" : ""}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="character-profile-select-label">{ui.character}</InputLabel>
                    <Select
                      labelId="character-profile-select-label"
                      id="character-profile-select"
                      label={ui.character}
                      value={selectedCharacterProfileId}
                      onChange={(event) => setSelectedCharacterProfileId(event.target.value)}
                    >
                      <MenuItem value="">{ui.none}</MenuItem>
                      {characterProfiles
                        .filter((profile) => profile.status !== "archived")
                        .map((profile) => (
                          <MenuItem key={profile.id} value={profile.id}>
                            {profile.name} · {profile.referenceAssetIds?.length || 0} {ui.refs}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              {selectedCharacterProfileId && (
                <Alert severity={modeReadiness?.characterConsistencyAvailable ? "success" : "warning"} sx={{ mt: 2 }}>
                  {modeReadiness?.characterConsistencyAvailable
                    ? ui.referenceReady
                    : ui.referenceUnavailable}
                </Alert>
              )}

              {modeReadiness && (
                <Box sx={{ mt: 2, p: 1.5, bgcolor: modeReadiness.ready ? "rgba(36,84,90,0.06)" : "rgba(220,38,38,0.08)", borderRadius: 2, border: "1px solid", borderColor: modeReadiness.ready ? "rgba(36,84,90,0.2)" : "rgba(220,38,38,0.3)" }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="caption" fontWeight={800} color={modeReadiness.ready ? "primary.main" : "error.main"}>
                      {modeReadiness.ready ? "Capability Readiness: READY" : "Capability Requirements Check:"}
                    </Typography>
                    {modeReadiness.capabilities?.map((cap: any) => (
                      <Chip
                        key={cap.id}
                        size="small"
                        label={`${cap.ready ? "✓" : "✗"} ${cap.name}`}
                        color={cap.ready ? "success" : cap.required ? "error" : "default"}
                        variant={cap.ready ? "filled" : "outlined"}
                        sx={{ fontSize: 11, height: 22 }}
                      />
                    ))}
                  </Stack>
                  {!modeReadiness.ready && modeReadiness.missingRequirements?.length > 0 && (
                    <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {modeReadiness.missingRequirements.join(" • ")}
                    </Typography>
                  )}
                  {modeReadiness.externalUsage?.length > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                      External Usage: {modeReadiness.externalUsage.join(" • ")}
                    </Typography>
                  )}
                </Box>
              )}
            </AccordionDetails>
          </Accordion>

          {(productionMode === "product_ad" || visualSource === "uploaded_media" || visualSource === "mixed") && (
            <SectionCard
              title={productionMode === "product_ad" ? ui.productMediaTitle : ui.selectedMediaTitle}
              description={
                productionMode === "product_ad"
                  ? ui.productMediaDescription
                  : ui.selectedMediaDescription
              }
              actions={
                <Button
                  variant="contained"
                  component="label"
                  size="small"
                  disabled={uploadingProduct}
                >
                  {uploadingProduct ? ui.uploadingProduct : ui.uploadProduct}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleProductFileUpload} />
                </Button>
              }
            >
              <Stack spacing={2}>
                {(productionMode === "product_ad" ? productCapableAssets.length === 0 : selectableMediaAssets.length === 0) && (
                  <Alert severity="warning">
                    {productionMode === "product_ad"
                      ? ui.missingProduct
                      : ui.missingMedia}
                    {unusableMediaAssets.length > 0
                      ? ` ${unusableMediaAssets.length} ${ui.unusableKept}`
                      : "."}
                  </Alert>
                )}
                {(productionMode === "product_ad" ? productCapableAssets : selectableMediaAssets).length > 0 && (
                  <Grid container spacing={1.5}>
                    {(productionMode === "product_ad" ? productCapableAssets : selectableMediaAssets).map((asset) => {
                      const selected = selectedMediaIds.includes(asset.id) || selectedProductMediaId === asset.id;
                      return (
                        <Grid item xs={12} sm={6} md={4} key={asset.id}>
                          <Card
                            variant="outlined"
                            onClick={() => {
                              selectMediaAsset(asset);
                            }}
                            sx={{
                              p: 1.25,
                              cursor: "pointer",
                              borderColor: selected ? "primary.main" : "divider",
                              bgcolor: selected ? "action.selected" : "background.paper",
                            }}
                          >
                            <Stack direction="row" spacing={1.25} alignItems="center">
                              {asset.mediaType === "image" ? (
                                <Box
                                  component="img"
                                  src={mediaPreviewUrl(asset)}
                                  alt={asset.displayName || asset.originalName || asset.filename}
                                  sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 1, bgcolor: "action.hover" }}
                                />
                              ) : (
                                <Box sx={{ width: 56, height: 56, borderRadius: 1, bgcolor: "action.hover", display: "grid", placeItems: "center", fontWeight: 800 }}>
                                  {mediaTypeLabel(ui, asset.mediaType).slice(0, 1)}
                                </Box>
                              )}
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" fontWeight={700} noWrap>
                                  {asset.displayName || asset.originalName || asset.filename}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {mediaTypeLabel(ui, asset.mediaType)}
                                  {asset.width && asset.height ? ` · ${asset.width}x${asset.height}` : ""}
                                  {asset.tags?.length ? ` · ${asset.tags.slice(0, 2).join(", ")}` : ""}
                                  {` · ${ui.usable}`}
                                </Typography>
                              </Box>
                            </Stack>
                          </Card>
                        </Grid>
                      );
                    })}
                  </Grid>
                )}
                {unusableMediaAssets.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {unusableMediaAssets.length} {ui.unusableKept}
                  </Typography>
                )}

                {productionMode === "product_ad" && <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Headline Banner"
                      value={productHeadline}
                      onChange={(e) => setProductHeadline(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="عرض حصري لفترة محدودة"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="Offer Badge"
                      value={productOffer}
                      onChange={(e) => setProductOffer(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="خصم 25%"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="Price Tag (Optional)"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="199 ج.م"
                    />
                  </Grid>
                  <Grid item xs={12} sm={8}>
                    <TextField
                      label="CTA Button Text"
                      value={productCta}
                      onChange={(e) => setProductCta(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="اطلب الآن عبر واتساب"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="placement-label">Product Placement</InputLabel>
                      <Select
                        labelId="placement-label"
                        label="Product Placement"
                        value={productPlacement}
                        onChange={(e) => setProductPlacement(e.target.value as any)}
                      >
                        <MenuItem value="center">Center</MenuItem>
                        <MenuItem value="left">Left</MenuItem>
                        <MenuItem value="right">Right</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>}
              </Stack>
            </SectionCard>
          )}

          {arabicBlocked && (
            <Alert
              severity="error"
              action={
                <Button size="small" variant="contained" onClick={() => navigate("/providers")}>
                  {arabicBlockedActionLabel()}
                </Button>
              }
            >
              {arabicBlockedMessage()}
            </Alert>
          )}
          <Alert severity={selectedProviderUnavailable && !arabicBlocked ? "warning" : "info"}>
            {voiceProviderGuidance()} {selectedProviderUnavailable && !arabicBlocked ? "Configure it in Providers before creating a video." : ""}
          </Alert>
          {selectedVoice && (
            <Alert severity="success">
              Resolved voice: {selectedVoice.provider} / {selectedVoice.id}
            </Alert>
          )}
          {voiceWarnings.length > 0 && (
            <Alert severity="warning">
              {voiceWarnings.join(" ")}
            </Alert>
          )}

          <SectionCard
            title="Voice Preview"
            description="Generate a short narration sample before committing to a full render."
            actions={
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={voicePreviewing || !prompt.trim() || selectedProviderUnavailable || arabicBlocked}
                onClick={handleVoicePreview}
              >
                {voicePreviewing ? "Generating..." : "Preview Voice"}
              </Button>
            }
          >
            <Stack spacing={1.5}>
              {voiceProvider === "google_cloud_tts" && (
                <Alert severity="info">
                  Google Cloud uses Arabic - Modern Standard Arabic (ar-XA). Billing may be required, and usage above Google's free monthly allowance may incur charges.
                </Alert>
              )}
              {selectedProviderUnavailable && (
                <Alert
                  severity="warning"
                  action={<Button size="small" onClick={() => navigate("/providers")}>Configure in Providers</Button>}
                >
                  This provider is not configured. Voice preview and full production will stay disabled until credentials are added.
                </Alert>
              )}
              {voicePreview ? (
                <>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip label={`Provider: ${voicePreview.provider}`} />
                    <Chip label={`Voice: ${voicePreview.voiceId}`} />
                    <Chip label={`Duration: ${voicePreview.durationSeconds}s`} />
                    {voicePreview.generationMs && <Chip label={`Generated: ${voicePreview.generationMs}ms`} />}
                  </Stack>
                  <Box component="audio" controls src={withMediaAccessToken(voicePreview.audioUrl)} sx={{ width: "100%" }} />
                  <Typography variant="body2" color="text.secondary" dir={voicePreview.language === "ar" ? "rtl" : "ltr"}>
                    {voicePreview.processedText}
                  </Typography>
                  {voicePreview.warnings?.length > 0 && (
                    <Alert severity="warning">{voicePreview.warnings.join(" ")}</Alert>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  The preview uses the current language, dialect, provider, voice, and quality settings.
                </Typography>
              )}
            </Stack>
          </SectionCard>

          {/* Cost Estimate & Live Spec Preview */}
          <SectionCard
            title="Production Summary"
            description="Plain-language summary of what will be produced. Technical details stay under Advanced."
            actions={
              <Button
                variant="outlined"
                startIcon={<VisibilityIcon />}
                disabled={previewing || !prompt.trim()}
                onClick={handlePreviewSpec}
              >
                {previewing ? "Planning..." : "Preview Production Spec"}
              </Button>
            }
          >
            {previewSpec ? (
              <Stack spacing={2}>
                {/* Duration Diagnostics Breakdown */}
                <Card variant="outlined" sx={{ p: 2, bgcolor: "background.paper" }}>
                  <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                    Timeline & Duration Breakdown
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Requested Duration</Typography>
                      <Typography variant="body1" fontWeight={700}>{previewSpec.durationSeconds}s</Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Scene Count</Typography>
                      <Typography variant="body1" fontWeight={700}>{previewSpec.scenes?.length || 0}</Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Scenes Total</Typography>
                      <Typography variant="body1" fontWeight={700}>
                        {Math.round((previewSpec.scenes?.reduce((acc: number, s: any) => acc + (s.durationSeconds || 0), 0) || 0) * 10) / 10}s
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Branded Outro</Typography>
                      <Typography variant="body1" fontWeight={700}>
                        {config.brandKit?.includeOutro ? "2.0s (Budgeted)" : "None (0s)"}
                      </Typography>
                    </Grid>
                  </Grid>
                </Card>

                {/* One canonical summary of what the engine resolved: voice,
                    captions, visuals, quality and cost, in plain language. */}
                <ProductionSummary spec={previewSpec} costEstimate={costEstimate as any} readiness={previewReadiness} />

                <Grid container spacing={1.5}>
                  {previewSpec.scenes?.map((scene: any, idx: number) => (
                    <Grid item xs={12} md={6} key={idx}>
                      <Card variant="outlined" sx={{ p: 1.5 }}>
                        <Stack spacing={0.5}>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="subtitle2" fontWeight={800}>
                              Scene {idx + 1} ({scene.purpose?.toUpperCase()})
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {scene.durationSeconds}s
                            </Typography>
                          </Stack>
                          <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                            "{scene.narration}"
                          </Typography>
                          {scene.onScreenText && (
                            <Typography variant="caption" color="primary">
                              On Screen: {scene.onScreenText}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            Footage: {scene.stockSearchTerms?.join(", ")}
                          </Typography>
                        </Stack>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Preview the production plan before generating, or create the video directly with the choices above.
              </Typography>
            )}
          </SectionCard>

          {readinessMessage() && (
            <Alert severity="warning" action={modeReadiness?.capabilities?.find((cap: any) => cap.required && !cap.ready)?.action ? (
              <Button
                size="small"
                color="inherit"
                onClick={() => navigate(modeReadiness.capabilities.find((cap: any) => cap.required && !cap.ready).action.href)}
              >
                {modeReadiness.capabilities.find((cap: any) => cap.required && !cap.ready).action.label}
              </Button>
            ) : undefined}>
              {readinessMessage()}
            </Alert>
          )}

          {/* Submit Action */}
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<SendIcon />}
              disabled={submitting || Boolean(readinessMessage())}
              onClick={submitPromptJob}
            >
              {submitting ? "Creating..." : "Create Video"}
            </Button>
          </Stack>
        </Stack>
      )}

      {/* ========================================================================= */}
      {/* PROMPT ENHANCEMENT COMPARISON DIALOG                                      */}
      {/* ========================================================================= */}
      <Dialog open={enhanceDialog} onClose={() => setEnhanceDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>AI Prompt Enhancement</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {enhanceResult?.changesSummary && (
              <Alert severity="info">{enhanceResult.changesSummary}</Alert>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" fontWeight={800} color="text.secondary">
                  Original Prompt
                </Typography>
                <Card variant="outlined" sx={{ p: 1.5, mt: 1, minHeight: 120, bgcolor: "action.hover" }}>
                  <Typography variant="body2">{enhanceResult?.originalPrompt}</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" fontWeight={800} color="primary">
                  Enhanced Prompt
                </Typography>
                <Card variant="outlined" sx={{ p: 1.5, mt: 1, minHeight: 120, borderColor: "primary.main" }}>
                  <Typography variant="body2">{enhanceResult?.enhancedPrompt}</Typography>
                </Card>
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnhanceDialog(false)}>Keep Original</Button>
          <Button variant="contained" onClick={acceptEnhancedPrompt}>
            Use Enhanced Prompt
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={saveTemplateDialog} onClose={() => setSaveTemplateDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Save Reusable Template</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              required
              label="Template name"
              value={saveTemplateName}
              onChange={(event) => setSaveTemplateName(event.target.value)}
            />
            <TextField
              label="Description"
              multiline
              minRows={2}
              value={saveTemplateDescription}
              onChange={(event) => setSaveTemplateDescription(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTemplateDialog(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={saveCurrentAsTemplate}>
            Save Template
          </Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* TEMPLATE MODE (PRESERVED BUSINESS TEMPLATES)                              */}
      {/* ========================================================================= */}
      {mode === "template" && (
        <Stack spacing={2.25}>
          <SectionCard>
            <Stepper activeStep={templateStep} alternativeLabel sx={{ mb: 3 }}>
              {templateSteps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {templateSteps.map((step, index) => (
                <Button
                  key={step}
                  size="small"
                  variant={templateStep === index ? "contained" : "outlined"}
                  onClick={() => setTemplateStep(index)}
                >
                  {step}
                </Button>
              ))}
            </Stack>
          </SectionCard>

          {templateStep === 0 && (
            <FormSection title="Template Selection" description="Choose a validated business template.">
              <Grid container spacing={2}>
                {templates.map((template) => (
                  <Grid item xs={12} md={6} xl={4} key={template.id}>
                    <SectionCard>
                      <Stack spacing={1.25}>
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Typography variant="h6">{template.displayName}</Typography>
                          {selectedTemplateId === template.id && <StatusBadge status="ready" label="Selected" />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{template.description}</Typography>
                        <Typography variant="caption" color="text.secondary">{template.targetUseCase}</Typography>
                        <Button
                          variant={selectedTemplateId === template.id ? "contained" : "outlined"}
                          onClick={() => applyTemplateDefaults(template)}
                        >
                          Use Template
                        </Button>
                      </Stack>
                    </SectionCard>
                  </Grid>
                ))}
              </Grid>
            </FormSection>
          )}

          {templateStep === 1 && (
            <FormSection title="Content" description="Required fields drive generated narration and Pexels search terms.">
              {selectedTemplate && (
                <Grid container spacing={2}>
                  {selectedTemplate.fields.map((field) => (
                    <Grid item xs={12} md={fieldGridSize(field)} key={field.key}>
                      {field.type === "select" ? (
                        <FormControl fullWidth>
                          <InputLabel>{field.label}</InputLabel>
                          <Select
                            label={field.label}
                            required={field.required}
                            value={templateData[field.key] || ""}
                            onChange={(e) => setTemplateData({ ...templateData, [field.key]: e.target.value })}
                          >
                            <MenuItem value="">Select</MenuItem>
                            {(field.options || []).map((opt) => (
                              <MenuItem value={opt} key={opt}>{opt}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <TextField
                          fullWidth
                          required={field.required}
                          type={field.type === "number" ? "number" : "text"}
                          multiline={field.type === "textarea"}
                          minRows={field.type === "textarea" ? 3 : undefined}
                          label={field.label}
                          placeholder={field.placeholder}
                          helperText={field.helperText}
                          value={templateData[field.key] || ""}
                          onChange={(e) => setTemplateData({ ...templateData, [field.key]: e.target.value })}
                        />
                      )}
                    </Grid>
                  ))}
                </Grid>
              )}
              <SectionCard title="Narration Preview" description="Generated from the selected template and field values.">
                <Stack spacing={1.5}>
                  {scenes.map((scene, index) => (
                    <TextField
                      key={index}
                      label={`Scene ${index + 1}`}
                      value={scene.text}
                      multiline
                      minRows={2}
                      fullWidth
                      onChange={(event) => {
                        const next = [...scenes];
                        next[index] = { ...next[index], text: event.target.value };
                        setScenes(next);
                      }}
                    />
                  ))}
                </Stack>
              </SectionCard>
            </FormSection>
          )}

          {templateStep === 2 && (
            <FormSection title="Brand Kit" description="Select a saved brand or customize Brand Kit for this video.">
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Saved Brand</InputLabel>
                    <Select
                      label="Saved Brand"
                      value={selectedBrandId}
                      onChange={(event) => {
                        const brand = brands.find((item) => item.id === event.target.value);
                        if (brand) applyBrand(brand);
                      }}
                    >
                      <MenuItem value="">Custom</MenuItem>
                      {brands.map((brand) => (
                        <MenuItem key={brand.id} value={brand.id}>{brand.name}{brand.isDefault ? " (default)" : ""}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Brand Name" value={config.brandKit?.brandName || ""} onChange={(e) => updateBrandKit("brandName", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Watermark" value={config.brandKit?.watermarkText || ""} onChange={(e) => updateBrandKit("watermarkText", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField fullWidth type="color" label="Primary Color" value={config.brandKit?.primaryColor || "#24545a"} onChange={(e) => updateBrandKit("primaryColor", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField fullWidth type="color" label="Accent Color" value={config.brandKit?.accentColor || "#d28b4c"} onChange={(e) => updateBrandKit("accentColor", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Caption Style</InputLabel>
                    <Select label="Caption Style" value={config.brandKit?.captionStyle || "bold"} onChange={(e) => updateBrandKit("captionStyle", e.target.value)}>
                      <MenuItem value="clean">Clean</MenuItem>
                      <MenuItem value="bold">Bold</MenuItem>
                      <MenuItem value="minimal">Minimal</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControlLabel
                    control={<Checkbox checked={config.brandKit?.includeOutro === true} onChange={(event) => updateBrandKit("includeOutro", event.target.checked)} />}
                    label="Outro"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Outro Text" value={config.brandKit?.outroText || ""} onChange={(e) => updateBrandKit("outroText", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Contact" value={config.brandKit?.contactText || ""} onChange={(e) => updateBrandKit("contactText", e.target.value)} />
                </Grid>
              </Grid>
            </FormSection>
          )}

          {templateStep === 3 && (
            <FormSection title="Video Settings" description="Render settings for template mode.">
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Voice</InputLabel>
                    <Select label="Voice" value={config.voice} onChange={(e) => setConfig({ ...config, voice: e.target.value as any })}>
                      {Object.values(VoiceEnum).map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Music</InputLabel>
                    <Select label="Music" value={config.music} onChange={(e) => setConfig({ ...config, music: e.target.value as any })}>
                      {Object.values(MusicMoodEnum).map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Orientation</InputLabel>
                    <Select label="Orientation" value={config.orientation} onChange={(e) => setConfig({ ...config, orientation: e.target.value as any })}>
                      {Object.values(OrientationEnum).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </FormSection>
          )}

          {templateStep === 4 && (
            <FormSection title="Review & Submit" description="Creating the video starts production. You can follow progress on the Productions page.">
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <SectionCard title="Request Overview">
                    <Stack spacing={1}>
                      <Typography>Template: {selectedTemplate?.displayName}</Typography>
                      <Typography>Brand: {config.brandKit?.brandName || "Custom"}</Typography>
                      <Typography>Scenes: {scenes.length}</Typography>
                    </Stack>
                  </SectionCard>
                </Grid>
                <Grid item xs={12} md={6}>
                  <SectionCard title="Pipeline Components">
                    <Stack spacing={1}>
                      {["Pexels Stock", "Kokoro TTS", "Whisper Captions", "Remotion / FFmpeg"].map((item) => (
                        <Stack key={item} direction="row" justifyContent="space-between">
                          <Typography>{item}</Typography>
                          <StatusBadge status="ready" label="Included" />
                        </Stack>
                      ))}
                    </Stack>
                  </SectionCard>
                </Grid>
              </Grid>
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
                <Button variant="contained" size="large" startIcon={<SendIcon />} disabled={submitting} onClick={submitTemplateJob}>
                  {submitting ? "Creating..." : "Create Video Job"}
                </Button>
              </Stack>
            </FormSection>
          )}

          <Stack direction="row" justifyContent="space-between">
            <Button disabled={templateStep === 0} onClick={() => setTemplateStep((s) => Math.max(s - 1, 0))}>
              Back
            </Button>
            <Button disabled={templateStep === templateSteps.length - 1} variant="outlined" onClick={() => setTemplateStep((s) => Math.min(s + 1, templateSteps.length - 1))}>
              Next
            </Button>
          </Stack>
        </Stack>
      )}
    </>
  );
};

export default VideoCreator;
