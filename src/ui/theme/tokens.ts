/**
 * SHORT STUDIO DESIGN TOKENS
 * --------------------------
 * The single source of colour, radius, spacing and elevation for the whole
 * dashboard. Components read from here (or from the MUI theme built on top of
 * it) and never hardcode a hex value, so the product reads as one system.
 *
 * Visual direction: premium near-black surfaces, a violet primary identity, a
 * restrained cyan accent and a green success state, with glow used sparingly.
 * This is an operational control panel, not a marketing page - contrast and
 * legibility win over spectacle, and glow is never placed behind body text.
 */

export type AbudPalette = {
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceElevated: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  secondary: string;
  secondaryMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  info: string;
  textPrimary: string;
  textSecondary: string;
  muted: string;
  focus: string;
  shadow: string;
  glow: string;
};

/** Canonical Short Studio dark theme. */
export const abudDark: AbudPalette = {
  background: "#07070C",
  backgroundAlt: "#0B0B14",
  surface: "#101020",
  surfaceElevated: "#16162A",
  surfaceHover: "#1C1C33",
  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.16)",
  primary: "#8B5CF6",
  primaryHover: "#A78BFA",
  primaryMuted: "rgba(139, 92, 246, 0.16)",
  secondary: "#22D3EE",
  secondaryMuted: "rgba(34, 211, 238, 0.14)",
  success: "#34D399",
  successMuted: "rgba(52, 211, 153, 0.14)",
  warning: "#FBBF24",
  warningMuted: "rgba(251, 191, 36, 0.14)",
  danger: "#F87171",
  dangerMuted: "rgba(248, 113, 113, 0.14)",
  info: "#60A5FA",
  textPrimary: "#F4F4FB",
  // Deliberately high for a dark UI: secondary text still has to be read.
  textSecondary: "#A9A9C4",
  // Raised from #6E6E8C, which browser QA measured at 3.8:1 against the
  // sidebar - below the 4.5:1 WCAG AA floor for small text. This value clears
  // AA on every Short Studio dark surface.
  muted: "#8E8EAC",
  focus: "#A78BFA",
  shadow: "0 18px 40px rgba(0, 0, 0, 0.55)",
  glow: "0 0 0 1px rgba(139, 92, 246, 0.35), 0 0 24px rgba(139, 92, 246, 0.18)",
};

/**
 * Optional light theme. Kept so the existing architecture still supports it,
 * but dark is canonical and is what the product ships with.
 */
export const abudLight: AbudPalette = {
  background: "#F6F6FA",
  backgroundAlt: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceHover: "#F1F0FA",
  border: "rgba(16, 16, 32, 0.10)",
  borderStrong: "rgba(16, 16, 32, 0.18)",
  primary: "#6D28D9",
  primaryHover: "#5B21B6",
  primaryMuted: "rgba(109, 40, 217, 0.10)",
  secondary: "#0891B2",
  secondaryMuted: "rgba(8, 145, 178, 0.10)",
  success: "#047857",
  successMuted: "rgba(4, 120, 87, 0.10)",
  warning: "#B45309",
  warningMuted: "rgba(180, 83, 9, 0.10)",
  danger: "#B91C1C",
  dangerMuted: "rgba(185, 28, 28, 0.10)",
  info: "#1D4ED8",
  textPrimary: "#14142B",
  textSecondary: "#4A4A66",
  muted: "#6E6E8C",
  focus: "#6D28D9",
  shadow: "0 10px 24px rgba(16, 16, 32, 0.10)",
  glow: "0 0 0 1px rgba(109, 40, 217, 0.20)",
};

export const abudRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

/**
 * TYPE SCALE
 * ----------
 * The dashboard used to lean on MUI's defaults, which put body text at 14px and
 * captions at 12px on a near-black background. That is legible on a designer's
 * monitor and genuinely hard to read on an operator's 1366x768 laptop, which is
 * why several screens read as dense walls of grey text.
 *
 * The scale below moves the floor up: nothing customer-facing is smaller than
 * 12.5px, body copy sits at 15px, and weight is used sparingly - 600 for
 * emphasis, 700 for headings, and nothing at 800+ except a card's headline
 * number. Heavy weight everywhere flattens hierarchy instead of creating it.
 *
 * Sizes are `rem` so a browser or OS text-size preference still scales the
 * whole product.
 */
export const abudType = {
  /** Page title. */
  h1: { size: "2rem", lineHeight: 1.2, weight: 700, letterSpacing: "-0.02em" },
  /** Section heading. */
  h2: { size: "1.5rem", lineHeight: 1.25, weight: 700, letterSpacing: "-0.015em" },
  /** Card heading. */
  h3: { size: "1.175rem", lineHeight: 1.3, weight: 650, letterSpacing: "-0.005em" },
  /** Sub-heading inside a card. */
  h4: { size: "1.0625rem", lineHeight: 1.35, weight: 600, letterSpacing: "0" },
  /** The large number on a metric card. */
  metric: { size: "1.875rem", lineHeight: 1.15, weight: 700, letterSpacing: "-0.02em" },
  /** Default reading size. */
  body: { size: "0.9375rem", lineHeight: 1.6, weight: 400, letterSpacing: "0" },
  /** Secondary reading size, still comfortably readable. */
  bodySmall: { size: "0.875rem", lineHeight: 1.55, weight: 400, letterSpacing: "0" },
  /** Field labels and table headers. */
  label: { size: "0.8125rem", lineHeight: 1.4, weight: 600, letterSpacing: "0.01em" },
  /** Helper text and timestamps - the smallest size the product ships. */
  caption: { size: "0.78125rem", lineHeight: 1.45, weight: 400, letterSpacing: "0.005em" },
  /** Section eyebrow above a page title. */
  overline: { size: "0.75rem", lineHeight: 1.4, weight: 700, letterSpacing: "0.09em" },
  button: { size: "0.9375rem", lineHeight: 1.4, weight: 600, letterSpacing: "0" },
} as const;

/**
 * Arabic needs a little more vertical room than Latin at the same nominal size:
 * the script carries diacritics above and descenders below the baseline, so a
 * line height tuned for Latin clips visually. Applied as a multiplier on the
 * body/line-height tokens when the interface is in Arabic.
 */
export const ARABIC_LINE_HEIGHT_FACTOR = 1.08;

/**
 * One harmonised superfamily for the whole product.
 *
 * IBM Plex Sans Arabic is IBM Plex Sans extended to Arabic by the same foundry,
 * so English and Arabic share proportions, stroke weight and rhythm - a screen
 * mixing an Arabic label with an English video ID reads as one design. Noto
 * Sans Arabic follows as the Arabic fallback so an unusual glyph still renders
 * in a professional Arabic face rather than dropping to Tahoma.
 *
 * Both are bundled locally: the dashboard never requests a font over the
 * network, because a production install may have no outbound internet at all.
 * Keep this in step with the `@font-face` block in `styles/index.css`; the copy
 * audit fails the build if the interface asks for a family nothing declares.
 */
export const ABUD_FONT_STACK =
  '"IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

/** Monospace is reserved for IDs and technical detail panels. */
export const ABUD_MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
