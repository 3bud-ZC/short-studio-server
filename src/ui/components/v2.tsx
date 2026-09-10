import React, { Component, ErrorInfo, ReactNode } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { useI18n } from "../i18n";
import { localizedStatus, TONE_TO_MUI_COLOR } from "../i18n/status";

// ============================================================================
// CONTENT-AWARE BIDIRECTIONAL (RTL/LTR) HELPERS
// ============================================================================

export function isArabicText(text?: string): boolean {
  if (!text) return false;
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicPattern.test(text);
}

/**
 * Direction props for a piece of *content* (a video title, a narration line),
 * as opposed to interface chrome.
 *
 * Content direction follows the content, not the interface: an English video
 * title in an Arabic interface still reads left to right, and an Arabic title
 * in an English interface still reads right to left. `textAlign: start` lets the
 * element's own `dir` place it, so the two never disagree.
 *
 * This used to request a `"Cairo"` font family that no `@font-face` rule ever
 * declared, so Arabic content silently fell through to Segoe UI or Tahoma while
 * the rest of the interface used IBM Plex Sans Arabic - two different Arabic
 * faces on the same screen. The family is now inherited from the theme, which
 * is the one bundled family the product actually loads.
 */
export function bidiProps(text?: string) {
  const isAr = isArabicText(text);
  return {
    dir: isAr ? ("rtl" as const) : ("ltr" as const),
    style: { textAlign: "start" as const },
  };
}

// ============================================================================
// REACT ERROR BOUNDARY
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("UI ErrorBoundary caught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorBoundaryFallback
          title={this.props.fallbackTitle}
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * The boundary's fallback, split out as a function component so it can use the
 * translation hook - a class component cannot.
 *
 * It also fixes a visual defect: the fallback used to paint a near-white card
 * (`#fff5f5`) inside a near-black product, so the one screen a customer sees
 * when something has already gone wrong was also the one screen that looked
 * broken. It now uses the theme's own error surface.
 */
function ErrorBoundaryFallback({
  title,
  error,
  onReset,
}: {
  title?: string;
  error: Error | null;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx: "auto", my: 4 }}>
      <Card variant="outlined" sx={{ borderRadius: 3, borderColor: "error.main" }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={2} alignItems="flex-start">
            <Stack direction="row" spacing={1.5} alignItems="center">
              <ErrorOutlineIcon color="error" sx={{ fontSize: 30 }} />
              <Typography variant="h5" color="error.main">
                {title || t("common.somethingWentWrong")}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("common.uiErrorBody")}
            </Typography>
            {error && (
              <Alert severity="error" sx={{ width: "100%", wordBreak: "break-word" }}>
                <AlertTitle>{t("common.errorDetail")}</AlertTitle>
                {/* An exception message is technical text: kept left-to-right
                    so a stack frame or a URL inside it stays readable in an
                    Arabic interface. */}
                <Box component="span" dir="ltr" sx={{ display: "block", textAlign: "start" }}>
                  {error.message || String(error)}
                </Box>
              </Alert>
            )}
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" startIcon={<RefreshIcon />} onClick={onReset}>
                {t("common.reloadPage")}
              </Button>
              <Button variant="outlined" onClick={() => (window.location.href = "/")}>
                {t("common.goToDashboard")}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

// ============================================================================
// PAGE HEADER
// ============================================================================

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", sm: "flex-start" }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box minWidth={0}>
        {eyebrow && (
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {description && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

// ============================================================================
// SECTION CARD
// ============================================================================

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      {(title || description || actions) && (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1.5}
            sx={{ px: 2.5, py: 1.75 }}
          >
            <Box sx={{ minWidth: 0 }}>
              {title && (
                <Typography variant="h6" component="h2">
                  {title}
                </Typography>
              )}
              {description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {description}
                </Typography>
              )}
            </Box>
            {actions}
          </Stack>
          <Divider />
        </>
      )}
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        {children}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// STANDARDIZED STAT CARD
// ============================================================================

/**
 * A single operational figure.
 *
 * The number is the loudest thing on the card and everything else is quiet
 * around it: a small uppercase label above, one line of context below. Colour
 * carries meaning rather than decoration - the number is neutral unless the
 * figure is something the operator should act on, and only then does it turn
 * amber or red.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger";
  onClick?: () => void;
}) {
  const valueColor =
    tone === "danger" ? "error.main" : tone === "warning" ? "warning.main" : "text.primary";

  return (
    <Card
      variant="outlined"
      onClick={onClick}
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            },
          }
        : {})}
      sx={{
        height: "100%",
        minHeight: 116,
        borderRadius: 2.5,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 0.15s ease, background-color 0.15s ease",
        "&:hover": onClick
          ? { borderColor: "primary.main", bgcolor: "action.hover" }
          : { borderColor: "divider" },
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
          {label}
        </Typography>
        <Typography
          sx={{
            my: 0.5,
            wordBreak: "break-word",
            color: valueColor,
            fontSize: "1.875rem",
            lineHeight: 1.15,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {hint}
          </Typography>
        ) : (
          <Box sx={{ height: 18 }} />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// STATUS COLORS & BADGE
// ============================================================================

export function statusColor(status: string): "success" | "warning" | "error" | "info" | "default" {
  if (!status) return "default";
  const s = status.toLowerCase();
  if (["ready", "healthy", "valid", "configured", "completed", "live_verified"].includes(s)) return "success";
  if (
    [
      "degraded",
      "rate_limited",
      "timeout",
      "planning",
      "rendering",
      "generating_voice",
      "generating_captions",
      "collecting_media",
      "missing_permissions",
      "voice_discovery_restricted",
    ].includes(s)
  ) return "warning";
  if (
    [
      "failed",
      "unhealthy",
      "invalid",
      "invalid_credentials",
      "missing",
      "not_configured",
      "unavailable",
      "provider_unavailable",
    ].includes(s)
  ) return "error";
  if (["canceled", "cancelled", "default"].includes(s)) return "default";
  return "info";
}

/**
 * The one status pill in the product.
 *
 * The raw backend status is mapped to the small localised vocabulary in
 * `i18n/status`, so `ready`, `live_verified` and `provider_unavailable` all
 * come out as words the customer recognises, in whichever language the
 * interface is in. Status is never colour alone - the label always ships with
 * the colour.
 */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { t } = useI18n();
  const descriptor = localizedStatus(status);
  return (
    <Chip
      size="small"
      label={label || t(descriptor.key)}
      color={TONE_TO_MUI_COLOR[descriptor.tone]}
      variant={descriptor.tone === "neutral" ? "outlined" : "filled"}
      sx={{ fontWeight: 600, px: 0.5 }}
    />
  );
}

export function ProviderStatus({
  name,
  category,
  status,
  message,
}: {
  name: string;
  category: string;
  status: string;
  message: string;
}) {
  return (
    <SectionCard>
      <Stack spacing={1.25}>
        <Stack direction="row" justifyContent="space-between" spacing={1}>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>
              {name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {category}
            </Typography>
          </Box>
          <StatusBadge status={status} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </Stack>
    </SectionCard>
  );
}

// ============================================================================
// PROGRESS DISPLAY
// ============================================================================

export function ProgressDisplay({
  stage,
  progress,
  timestamp,
  message,
}: {
  stage: string;
  progress: number;
  timestamp?: string;
  message?: string;
}) {
  const { t, format } = useI18n();
  // The progress message is produced by the pipeline and may be in either
  // language, so it carries its own direction rather than the interface's.
  const messageDir = bidiProps(message);
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="body2" fontWeight={650}>
          {t(localizedStatus(stage).key)}
        </Typography>
        <Typography variant="body2" fontWeight={650} color="primary.main">
          {format.percent(Math.min(100, Math.max(0, progress)) / 100)}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, Math.max(0, progress))}
        sx={{ height: 6, borderRadius: 3 }}
      />
      <Typography variant="caption" color="text.secondary" dir={messageDir.dir} sx={messageDir.style}>
        {message || t("common.loading")}
        {timestamp ? ` · ${format.time(timestamp)}` : ""}
      </Typography>
    </Stack>
  );
}

// ============================================================================
// RECENT PRODUCTION CARD
// ============================================================================

/**
 * One production, as it appears on the dashboard and in lists.
 *
 * The previous card showed a title, a stage and a percentage, which made six
 * consecutive productions look almost identical. This one carries the facts
 * that actually distinguish them - output language, how it was created, how
 * long the video runs, when it was requested - and offers the action that fits
 * the state: preview a completed video, look at the error on a failed one.
 *
 * The title follows its own direction: an Arabic title stays right-to-left in
 * an English interface, and the metadata line beside it stays in the
 * interface's direction.
 */
export function RecentJobCard({
  job,
  onClick,
  onPreview,
  onViewError,
}: {
  job: {
    id: string;
    title?: string;
    templateId?: string;
    brandName?: string;
    status: string;
    customerStatus?: string;
    progress: number;
    currentStage: string;
    creationMode?: string;
    language?: string;
    durationSeconds?: number;
    createdAt: string;
    updatedAt: string;
    error?: string | null;
    failure?: { category?: string; messageAr?: string; message?: string };
  };
  onClick?: () => void;
  onPreview?: () => void;
  onViewError?: () => void;
}) {
  const { t, format } = useI18n();
  const titleDir = bidiProps(job.title);
  const displayTitle = job.title || job.templateId || t("videos.untitled");
  const isActive = !["ready", "failed", "canceled", "cancelled"].includes(job.status);

  const facts = [
    job.language ? job.language.toUpperCase() : null,
    job.creationMode === "prompt" ? t("productions.typePrompt") : job.templateId ? t("productions.typeTemplate") : null,
    typeof job.durationSeconds === "number" ? format.duration(job.durationSeconds) : null,
    job.brandName || null,
  ].filter(Boolean) as string[];

  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{
        borderRadius: 2.5,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 0.15s ease, background-color 0.15s ease",
        "&:hover": onClick
          ? { borderColor: "primary.main", bgcolor: "action.hover" }
          : {},
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="subtitle1"
                dir={titleDir.dir}
                sx={{ ...titleDir.style, wordBreak: "break-word", lineHeight: 1.35 }}
              >
                {displayTitle}
              </Typography>
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                flexWrap="wrap"
                sx={{ mt: 0.5, rowGap: 0.5 }}
              >
                {facts.map((fact) => (
                  <Chip key={fact} label={fact} size="small" variant="outlined" />
                ))}
                <Typography variant="caption" color="text.secondary">
                  {format.relative(job.createdAt)}
                </Typography>
              </Stack>
            </Box>
            <StatusBadge status={job.customerStatus || job.status} />
          </Stack>

          {/* Progress is only meaningful while the job is moving. A finished
              production showing a full bar is noise on every card. */}
          {isActive && (
            <Stack spacing={0.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {t(localizedStatus(job.currentStage || job.status).key)}
                </Typography>
                <Typography variant="caption" fontWeight={650} color="primary.main">
                  {format.percent(Math.min(100, Math.max(0, job.progress)) / 100)}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, Math.max(0, job.progress))}
                sx={{ height: 5, borderRadius: 3 }}
              />
            </Stack>
          )}

          {job.status === "failed" && (
            <Typography
              variant="caption"
              color="error.main"
              sx={{ display: "block", wordBreak: "break-word" }}
            >
              {job.failure?.category
                ? t(`productions.failure.${job.failure.category}`)
                : (job.failure?.messageAr || job.error || t("productions.failure.UNKNOWN"))}
            </Typography>
          )}

          {(onPreview || onViewError) && (
            <Stack direction="row" spacing={1}>
              {job.status === "ready" && onPreview && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreview();
                  }}
                >
                  {t("common.preview")}
                </Button>
              )}
              {job.status === "failed" && onViewError && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewError();
                  }}
                >
                  {t("dashboard.recentProductions.viewError")}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// SKELETONS & LOADING STATES
// ============================================================================

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: 260 }}>
      <CircularProgress size={28} />
      <Typography color="text.secondary">{label || t("common.loading")}</Typography>
    </Stack>
  );
}

/**
 * Loading placeholders.
 *
 * Widths are capped at the container rather than set in fixed pixels: a 380px
 * text skeleton inside a 390px phone frame pushed the whole document 6px wide,
 * so the dashboard showed a horizontal scrollbar for the first second of every
 * load. Browser QA caught it as a transient overflow.
 */
export function DashboardSkeleton() {
  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Skeleton variant="text" height={36} sx={{ width: "min(220px, 100%)" }} />
        <Skeleton variant="text" height={20} sx={{ width: "min(380px, 100%)" }} />
      </Stack>
      <Grid container spacing={2}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={i}>
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
        </Grid>
      </Grid>
    </Stack>
  );
}

export function JobDetailsSkeleton() {
  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Skeleton variant="text" height={40} sx={{ width: "min(300px, 100%)" }} />
          <Skeleton variant="text" height={20} sx={{ width: "min(200px, 100%)" }} />
        </Box>
        <Skeleton variant="rectangular" height={36} sx={{ borderRadius: 1, width: "min(120px, 100%)" }} />
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Stack spacing={2}>
            <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
          </Stack>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Stack spacing={2}>
            <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}

export function JobsListSkeleton() {
  return (
    <Stack spacing={2}>
      <Skeleton variant="text" height={36} sx={{ width: "min(200px, 100%)" }} />
      <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 2 }} />
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
      ))}
    </Stack>
  );
}

// ============================================================================
// EMPTY & ERROR STATES
// ============================================================================

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <SectionCard>
      <Stack alignItems="center" textAlign="center" spacing={1.5} sx={{ py: 4 }}>
        <Typography variant="h6" fontWeight={800}>{title}</Typography>
        {description && (
          <Typography color="text.secondary" sx={{ maxWidth: 520, fontSize: "0.9rem" }}>
            {description}
          </Typography>
        )}
        {action && <Box sx={{ mt: 1 }}>{action}</Box>}
      </Stack>
    </SectionCard>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      severity="error"
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {message}
    </Alert>
  );
}

// ============================================================================
// DIALOGS & INPUTS
// ============================================================================

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">{description}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          {confirmLabel || t("common.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextField
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      size="small"
      fullWidth
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
      }}
    />
  );
}

export function FilterTabs({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Tabs value={value} onChange={(_, next) => onChange(next)} variant="scrollable" allowScrollButtonsMobile>
      {options.map((option) => (
        <Tab
          key={option}
          value={option}
          label={option === "all" ? t("common.all") : t(localizedStatus(option).key)}
        />
      ))}
    </Tabs>
  );
}

export function ActionMenu({
  items,
}: {
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
}) {
  const { t } = useI18n();
  const moreActionsLabel = t("common.moreActions");
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);
  return (
    <>
      <IconButton aria-label={moreActionsLabel} onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              setAnchor(null);
              item.onClick();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <SectionCard title={title} description={description}>
      {children}
    </SectionCard>
  );
}
