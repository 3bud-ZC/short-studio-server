import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestoreIcon from "@mui/icons-material/Restore";
import SaveIcon from "@mui/icons-material/Save";
import { useNavigate } from "react-router-dom";
import { EmptyState, LoadingState, PageHeader, SearchInput, SectionCard, StatusBadge } from "../components/v2";
import { useI18n } from "../i18n";
import type { BusinessTemplateOption, TemplateVariable, V2Brand } from "./v2Types";
import { CAPTION_STYLE_LABELS, DURATION_OPTIONS, QUALITY_LABELS, VISUAL_MODE_LABELS } from "./videoTypes";
import { aspectLabelKey, mediaStrategyLabelKey, qualityLabelKey } from "./displayLabels";

/**
 * A built-in template's customer-facing name and description live in the
 * translation catalogue, not in the English record the backend serves. Custom
 * templates keep the name their author typed.
 */
function builtInTemplateKey(id: string, field: "name" | "description"): string {
  return `templates.catalog.${id}.${field}`;
}

type TemplateDraft = {
  id?: string;
  name: string;
  description: string;
  category: string;
  baseTemplateId: string;
  favorite: boolean;
  archived: boolean;
  config: Record<string, any>;
  variables: TemplateVariable[];
};

const copy = {
  en: {
    title: "Templates",
    description: "Reusable video templates for repeatable offers, product ads, explainers and branded short-form campaigns.",
    search: "Search templates",
    create: "Create Template",
    edit: "Edit Template",
    duplicate: "Duplicate",
    archive: "Archive",
    restore: "Restore",
    use: "Create Video",
    save: "Save Template",
    empty: "No templates match your filters.",
    all: "All",
    builtIn: "Built-in",
    custom: "Custom",
    favorites: "Favorites",
    archived: "Archived",
    saved: "Template saved.",
    created: "Template created.",
    duplicated: "Template duplicated.",
    archivedMsg: "Template archived.",
    restored: "Template restored.",
    identity: "Template Identity",
    defaults: "Video Defaults",
    variables: "Variables",
    addVariable: "Add Variable",
    noVariables: "No variables yet.",
  },
  ar: {
    title: "القوالب",
    description: "قوالب فيديو قابلة لإعادة الاستخدام للعروض وإعلانات المنتجات والشرح والحملات القصيرة بالهوية.",
    search: "بحث في القوالب",
    create: "إنشاء قالب",
    edit: "تعديل القالب",
    duplicate: "نسخ",
    archive: "أرشفة",
    restore: "استرجاع",
    use: "إنشاء فيديو",
    save: "حفظ القالب",
    empty: "لا توجد قوالب تطابق الفلاتر.",
    all: "الكل",
    builtIn: "مدمجة",
    custom: "مخصصة",
    favorites: "المفضلة",
    archived: "مؤرشفة",
    saved: "تم حفظ القالب.",
    created: "تم إنشاء القالب.",
    duplicated: "تم نسخ القالب.",
    archivedMsg: "تمت أرشفة القالب.",
    restored: "تم استرجاع القالب.",
    identity: "هوية القالب",
    defaults: "إعدادات الفيديو",
    variables: "المتغيرات",
    addVariable: "إضافة متغير",
    noVariables: "لا توجد متغيرات بعد.",
  },
};

const fallbackCategories = ["social", "product", "business", "educational", "explainer", "event", "promotional"];

const categoryLabels: Record<string, string> = {
  social: "Social",
  product: "Product",
  business: "Business",
  educational: "Educational",
  explainer: "Explainer",
  event: "Event",
  promotional: "Promotional",
};

const visualSources = [
  { id: "auto_best", label: "Auto Best" },
  { id: "stock", label: VISUAL_MODE_LABELS.stock },
  { id: "uploaded_media", label: VISUAL_MODE_LABELS.uploaded_media },
  { id: "ai_generated", label: VISUAL_MODE_LABELS.ai },
  { id: "mixed", label: VISUAL_MODE_LABELS.hybrid },
];

const captionStyles = ["social_ad", "clean_professional", "minimal", "karaoke", "cinematic", "none"];

function newDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    category: "social",
    baseTemplateId: "",
    favorite: false,
    archived: false,
    config: {
      durationSeconds: 15,
      aspectRatio: "9:16",
      quality: "standard",
      visualSource: "auto_best",
      captionStyle: "social_ad",
      promptGuidance: "",
    },
    variables: [],
  };
}

function draftFromTemplate(template: BusinessTemplateOption): TemplateDraft {
  return {
    id: template.id,
    name: template.displayName || template.name || "",
    description: template.description || "",
    category: template.category || "social",
    baseTemplateId: template.baseTemplateId || "",
    favorite: Boolean(template.favorite),
    archived: Boolean(template.archived),
    config: {
      durationSeconds: template.config?.durationSeconds || template.targetDurationSeconds || template.suggestedDurationSeconds || 15,
      aspectRatio: template.config?.aspectRatio || "9:16",
      quality: template.config?.quality || "standard",
      visualSource: template.config?.visualSource || "auto_best",
      captionStyle: template.config?.captionStyle || "social_ad",
      brandId: template.config?.brandId || "",
      promptGuidance: template.config?.promptGuidance || template.examplePrompt || "",
    },
    variables: template.variables || [],
  };
}

function humanCategory(value?: string) {
  return categoryLabels[value || ""] || value || "Template";
}

function cleanPayload(draft: TemplateDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category,
    baseTemplateId: draft.baseTemplateId || undefined,
    favorite: draft.favorite,
    archived: draft.archived,
    config: {
      ...draft.config,
      brandId: draft.config.brandId || undefined,
      promptGuidance: draft.config.promptGuidance || undefined,
    },
    variables: draft.variables
      .map((variable) => ({
        ...variable,
        key: variable.key.trim(),
        label: variable.label.trim(),
        defaultValue: variable.defaultValue?.trim() || undefined,
        example: variable.example?.trim() || undefined,
        helpText: variable.helpText?.trim() || undefined,
      }))
      .filter((variable) => variable.key && variable.label),
  };
}

const TemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const { locale, direction, t, format } = useI18n();
  const strings = copy[locale === "ar" ? "ar" : "en"];
  const [templates, setTemplates] = useState<BusinessTemplateOption[]>([]);
  const [brands, setBrands] = useState<V2Brand[]>([]);
  const [categories, setCategories] = useState<string[]>(fallbackCategories);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "built_in" | "custom">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showFavorites, setShowFavorites] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(newDraft());
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const [templateResponse, brandResponse] = await Promise.all([
        axios.get("/api/v2/templates", { params: { includeArchived: showArchived } }),
        axios.get("/api/v2/brands").catch(() => ({ data: { brands: [] } })),
      ]);
      setTemplates(templateResponse.data.templates || []);
      setCategories(templateResponse.data.categories || fallbackCategories);
      setBrands(brandResponse.data.brands || []);
      setError(null);
    } catch {
      setError(locale === "ar" ? "تعذر تحميل القوالب." : "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [showArchived]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return templates.filter((template) => {
      const text = `${template.displayName} ${template.description} ${template.targetUseCase} ${template.category}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      if (sourceFilter !== "all" && template.source !== sourceFilter) return false;
      if (categoryFilter !== "all" && template.category !== categoryFilter) return false;
      if (showFavorites && !template.favorite) return false;
      return showArchived ? true : !template.archived;
    });
  }, [templates, query, sourceFilter, categoryFilter, showFavorites, showArchived]);

  const openCreate = () => {
    setDraft(newDraft());
    setEditorOpen(true);
  };

  const openEdit = (template: BusinessTemplateOption) => {
    setDraft(draftFromTemplate(template));
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      const payload = cleanPayload(draft);
      if (!payload.name) {
        setError(locale === "ar" ? "اسم القالب مطلوب." : "Template name is required.");
        return;
      }
      if (draft.id) {
        await axios.put(`/api/v2/templates/${draft.id}`, payload);
        setMessage(strings.saved);
      } else {
        await axios.post("/api/v2/templates", payload);
        setMessage(strings.created);
      }
      setEditorOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || (locale === "ar" ? "تعذر حفظ القالب." : "Template could not be saved."));
    }
  };

  const duplicate = async (template: BusinessTemplateOption) => {
    try {
      await axios.post(`/api/v2/templates/${template.id}/duplicate`);
      setMessage(strings.duplicated);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Duplicate failed.");
    }
  };

  const favorite = async (template: BusinessTemplateOption) => {
    try {
      await axios.post(`/api/v2/templates/${template.id}/favorite`, { favorite: !template.favorite });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Favorite update failed.");
    }
  };

  const archive = async (template: BusinessTemplateOption) => {
    try {
      await axios.delete(`/api/v2/templates/${template.id}`);
      setMessage(strings.archivedMsg);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Archive failed.");
    }
  };

  const restore = async (template: BusinessTemplateOption) => {
    try {
      await axios.post(`/api/v2/templates/${template.id}/restore`);
      setMessage(strings.restored);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Restore failed.");
    }
  };

  function updateVariable(index: number, patch: Partial<TemplateVariable>) {
    setDraft((prev) => ({
      ...prev,
      variables: prev.variables.map((variable, current) => current === index ? { ...variable, ...patch } : variable),
    }));
  }

  /** The customer-facing name: catalogue for built-ins, author's own for custom. */
  const templateName = (template: BusinessTemplateOption): string =>
    template.builtIn ? t(builtInTemplateKey(template.id, "name")) : template.displayName;

  const templateDescription = (template: BusinessTemplateOption): string =>
    template.builtIn
      ? t(builtInTemplateKey(template.id, "description"))
      : template.description || template.targetUseCase;

  /**
   * One line saying what this template actually produces - shape, length,
   * quality and where the pictures come from. Every value is resolved through
   * the same display-label map the rest of the product uses, so it reads as a
   * sentence rather than a row of engine enums.
   */
  const templateProduces = (template: BusinessTemplateOption): string => {
    const config = template.config || {};
    const seconds = Number(
      config.durationSeconds || template.targetDurationSeconds || template.suggestedDurationSeconds || 0,
    );
    return [
      t(aspectLabelKey(config.aspectRatio)),
      seconds > 0 ? format.duration(seconds) : "",
      t(qualityLabelKey(config.quality)),
      t(mediaStrategyLabelKey(config.visualSource || config.productionMode)),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  if (loading) return <LoadingState label={t("templates.loading")} />;

  return (
    <>
      <PageHeader
        title={strings.title}
        description={strings.description}
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{strings.create}</Button>}
      />
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <SectionCard>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }} dir={direction}>
          <SearchInput value={query} onChange={setQuery} placeholder={strings.search} />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t("templates.source")}</InputLabel>
            <Select label={t("templates.source")} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as any)}>
              <MenuItem value="all">{strings.all}</MenuItem>
              <MenuItem value="built_in">{strings.builtIn}</MenuItem>
              <MenuItem value="custom">{strings.custom}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t("templates.category")}</InputLabel>
            <Select label={t("templates.category")} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <MenuItem value="all">{strings.all}</MenuItem>
              {categories.map((category) => <MenuItem key={category} value={category}>{humanCategory(category)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControlLabel control={<Checkbox checked={showFavorites} onChange={(event) => setShowFavorites(event.target.checked)} />} label={strings.favorites} />
          <FormControlLabel control={<Checkbox checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />} label={strings.archived} />
        </Stack>
      </SectionCard>

      <Grid container spacing={2} sx={{ mt: 0.5 }} dir={direction}>
        {filtered.map((template) => (
          <Grid item xs={12} md={6} xl={4} key={template.id}>
            <SectionCard>
              <Stack spacing={1.25}>
                <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                  <Box>
                    <Typography variant="h6">{templateName(template)}</Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 0.75 }}>
                      <StatusBadge status={template.builtIn ? "ready" : "default"} label={template.builtIn ? strings.builtIn : strings.custom} />
                      <StatusBadge status="default" label={humanCategory(template.category)} />
                      {template.archived && <StatusBadge status="default" label={strings.archived} />}
                      {template.revision && <StatusBadge status="default" label={`r${template.revision}`} />}
                    </Stack>
                  </Box>
                  <Tooltip title={strings.favorites}>
                    <IconButton size="small" onClick={() => favorite(template)} color={template.favorite ? "primary" : "default"}>
                      {template.favorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Typography color="text.secondary">{templateDescription(template)}</Typography>
                {/* What this template really configures, rather than a row of
                    English editorial notes the Arabic interface could not
                    translate. */}
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {t("templates.produces")}
                </Typography>
                <Typography variant="body2" fontWeight={600}>{templateProduces(template)}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => navigate(`/create?template=${template.id}`)}>{strings.use}</Button>
                  {!template.builtIn && <Button startIcon={<EditIcon />} onClick={() => openEdit(template)}>{strings.edit}</Button>}
                  <Button startIcon={<ContentCopyIcon />} onClick={() => duplicate(template)}>{strings.duplicate}</Button>
                  {template.archived
                    ? <Button startIcon={<RestoreIcon />} onClick={() => restore(template)}>{strings.restore}</Button>
                    : !template.builtIn && <Button color="warning" startIcon={<ArchiveIcon />} onClick={() => archive(template)}>{strings.archive}</Button>}
                </Stack>
              </Stack>
            </SectionCard>
          </Grid>
        ))}
      </Grid>
      {filtered.length === 0 && <EmptyState title={strings.empty} />}

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{draft.id ? strings.edit : strings.create}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25} sx={{ pt: 1 }} dir={direction}>
            <Typography variant="subtitle2" fontWeight={800}>{strings.identity}</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}><TextField fullWidth required label={locale === "ar" ? "اسم القالب" : "Template name"} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>{locale === "ar" ? "الفئة" : "Category"}</InputLabel>
                  <Select label={locale === "ar" ? "الفئة" : "Category"} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                    {categories.map((category) => <MenuItem key={category} value={category}>{humanCategory(category)}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}><TextField fullWidth multiline minRows={2} label={locale === "ar" ? "الوصف" : "Description"} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Grid>
              <Grid item xs={12}>
                <TextField fullWidth multiline minRows={3} label={locale === "ar" ? "توجيه النص" : "Prompt guidance"} value={draft.config.promptGuidance || ""} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, promptGuidance: event.target.value } })} />
              </Grid>
            </Grid>

            <Divider />
            <Typography variant="subtitle2" fontWeight={800}>{strings.defaults}</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>{locale === "ar" ? "المدة" : "Duration"}</InputLabel>
                  <Select label={locale === "ar" ? "المدة" : "Duration"} value={draft.config.durationSeconds || 15} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, durationSeconds: Number(event.target.value) } })}>
                    {DURATION_OPTIONS.map((seconds) => <MenuItem key={seconds} value={seconds}>{seconds}s</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>{locale === "ar" ? "مصدر الصورة" : "Visual source"}</InputLabel>
                  <Select label={locale === "ar" ? "مصدر الصورة" : "Visual source"} value={draft.config.visualSource || "auto_best"} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, visualSource: event.target.value } })}>
                    {visualSources.map((source) => <MenuItem key={source.id} value={source.id}>{source.label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>{locale === "ar" ? "الجودة" : "Quality"}</InputLabel>
                  <Select label={locale === "ar" ? "الجودة" : "Quality"} value={draft.config.quality || "standard"} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, quality: event.target.value } })}>
                    {Object.entries(QUALITY_LABELS).map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>{locale === "ar" ? "التعليقات" : "Captions"}</InputLabel>
                  <Select label={locale === "ar" ? "التعليقات" : "Captions"} value={draft.config.captionStyle || "social_ad"} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, captionStyle: event.target.value } })}>
                    {captionStyles.map((style) => <MenuItem key={style} value={style}>{CAPTION_STYLE_LABELS[style] || style}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>{locale === "ar" ? "العلامة" : "Brand"}</InputLabel>
                  <Select label={locale === "ar" ? "العلامة" : "Brand"} value={draft.config.brandId || ""} onChange={(event) => setDraft({ ...draft, config: { ...draft.config, brandId: event.target.value } })}>
                    <MenuItem value="">{strings.all}</MenuItem>
                    {brands.map((brand) => <MenuItem key={brand.id} value={brand.id}>{brand.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControlLabel control={<Checkbox checked={draft.favorite} onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })} />} label={strings.favorites} />
              </Grid>
            </Grid>

            <Divider />
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2" fontWeight={800}>{strings.variables}</Typography>
              <Button startIcon={<AddIcon />} onClick={() => setDraft({ ...draft, variables: [...draft.variables, { key: "", label: "", type: "text", required: false }] })}>{strings.addVariable}</Button>
            </Stack>
            {draft.variables.length === 0 && <Typography color="text.secondary">{strings.noVariables}</Typography>}
            {draft.variables.map((variable, index) => (
              <Grid container spacing={1.25} key={index}>
                <Grid item xs={12} md={3}><TextField fullWidth label="Key" value={variable.key} onChange={(event) => updateVariable(index, { key: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} /></Grid>
                <Grid item xs={12} md={3}><TextField fullWidth label={locale === "ar" ? "التسمية" : "Label"} value={variable.label} onChange={(event) => updateVariable(index, { label: event.target.value })} /></Grid>
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth>
                    <InputLabel>{locale === "ar" ? "النوع" : "Type"}</InputLabel>
                    <Select label={locale === "ar" ? "النوع" : "Type"} value={variable.type} onChange={(event) => updateVariable(index, { type: event.target.value as any })}>
                      {["text", "number", "date", "url", "media_asset"].map((type) => <MenuItem key={type} value={type}>{type.replace("_", " ")}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={2}><TextField fullWidth label={locale === "ar" ? "افتراضي" : "Default"} value={variable.defaultValue || ""} onChange={(event) => updateVariable(index, { defaultValue: event.target.value })} /></Grid>
                <Grid item xs={8} md={1}><FormControlLabel control={<Checkbox checked={variable.required === true} onChange={(event) => updateVariable(index, { required: event.target.checked })} />} label={locale === "ar" ? "مطلوب" : "Req"} /></Grid>
                <Grid item xs={4} md={1}><Button color="warning" onClick={() => setDraft({ ...draft, variables: draft.variables.filter((_, current) => current !== index) })}>{locale === "ar" ? "حذف" : "Remove"}</Button></Grid>
              </Grid>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditorOpen(false)}>{locale === "ar" ? "إلغاء" : "Cancel"}</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={save}>{strings.save}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default TemplatesPage;
