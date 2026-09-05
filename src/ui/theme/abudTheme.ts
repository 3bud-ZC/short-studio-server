import { createTheme, type Theme } from "@mui/material";
import {
  ABUD_FONT_STACK,
  abudDark,
  abudLight,
  abudRadius,
  abudType,
  ARABIC_LINE_HEIGHT_FACTOR,
  type AbudPalette,
} from "./tokens";

/**
 * Builds the MUI theme from Short Studio tokens.
 *
 * Everything visual is derived here so a component never needs a literal
 * colour or font size. Where a component does need a token directly it reads
 * `theme.abud`, which carries the full palette.
 *
 * The theme is direction-aware. `direction: "rtl"` is what makes MUI's own
 * components (Drawer anchor, Tabs, Slider, pagination, icon buttons with an
 * `edge`) lay themselves out right-to-left; the emotion RTL plugin in
 * `rtlCache.ts` handles the physical CSS the application itself emits.
 */
declare module "@mui/material/styles" {
  interface Theme {
    abud: AbudPalette;
  }
  interface ThemeOptions {
    abud?: AbudPalette;
  }
}

export type ThemeDirection = "ltr" | "rtl";

export function buildAbudTheme(
  mode: "dark" | "light" = "dark",
  direction: ThemeDirection = "ltr",
): Theme {
  const t = mode === "dark" ? abudDark : abudLight;
  const isDark = mode === "dark";
  // Arabic sits slightly taller at the same nominal size; see the token comment.
  const lh = (base: number) => (direction === "rtl" ? base * ARABIC_LINE_HEIGHT_FACTOR : base);

  return createTheme({
    abud: t,
    direction,
    palette: {
      mode,
      primary: { main: t.primary, dark: t.primaryHover, contrastText: "#FFFFFF" },
      secondary: { main: t.secondary, contrastText: isDark ? "#04121A" : "#FFFFFF" },
      success: { main: t.success },
      warning: { main: t.warning },
      error: { main: t.danger },
      info: { main: t.info },
      background: { default: t.background, paper: t.surface },
      text: { primary: t.textPrimary, secondary: t.textSecondary, disabled: t.muted },
      divider: t.border,
      action: {
        hover: t.surfaceHover,
        selected: t.primaryMuted,
      },
    },
    shape: { borderRadius: abudRadius.md },
    typography: {
      fontFamily: ABUD_FONT_STACK,
      // Body text is the size everything else is judged against; 15px rather
      // than MUI's 14px default.
      fontSize: 15,
      htmlFontSize: 16,
      h1: {
        fontSize: abudType.h1.size,
        lineHeight: lh(abudType.h1.lineHeight),
        fontWeight: abudType.h1.weight,
        letterSpacing: abudType.h1.letterSpacing,
      },
      h2: {
        fontSize: abudType.h2.size,
        lineHeight: lh(abudType.h2.lineHeight),
        fontWeight: abudType.h2.weight,
        letterSpacing: abudType.h2.letterSpacing,
      },
      h3: {
        fontSize: abudType.h3.size,
        lineHeight: lh(abudType.h3.lineHeight),
        fontWeight: abudType.h3.weight,
        letterSpacing: abudType.h3.letterSpacing,
      },
      // h4 is the page title across the product, so it carries the h1 scale.
      h4: {
        fontSize: abudType.h1.size,
        lineHeight: lh(abudType.h1.lineHeight),
        fontWeight: abudType.h1.weight,
        letterSpacing: abudType.h1.letterSpacing,
      },
      h5: {
        fontSize: abudType.h2.size,
        lineHeight: lh(abudType.h2.lineHeight),
        fontWeight: abudType.h2.weight,
        letterSpacing: abudType.h2.letterSpacing,
      },
      h6: {
        fontSize: abudType.h3.size,
        lineHeight: lh(abudType.h3.lineHeight),
        fontWeight: abudType.h3.weight,
        letterSpacing: abudType.h3.letterSpacing,
      },
      subtitle1: {
        fontSize: abudType.h4.size,
        lineHeight: lh(abudType.h4.lineHeight),
        fontWeight: abudType.h4.weight,
      },
      subtitle2: {
        fontSize: abudType.label.size,
        lineHeight: lh(abudType.label.lineHeight),
        fontWeight: abudType.label.weight,
        letterSpacing: abudType.label.letterSpacing,
      },
      body1: {
        fontSize: abudType.body.size,
        lineHeight: lh(abudType.body.lineHeight),
        letterSpacing: abudType.body.letterSpacing,
      },
      body2: {
        fontSize: abudType.bodySmall.size,
        lineHeight: lh(abudType.bodySmall.lineHeight),
        letterSpacing: abudType.bodySmall.letterSpacing,
      },
      caption: {
        fontSize: abudType.caption.size,
        lineHeight: lh(abudType.caption.lineHeight),
        letterSpacing: abudType.caption.letterSpacing,
      },
      overline: {
        fontSize: abudType.overline.size,
        lineHeight: lh(abudType.overline.lineHeight),
        fontWeight: abudType.overline.weight,
        letterSpacing: abudType.overline.letterSpacing,
        textTransform: "uppercase",
      },
      button: {
        fontSize: abudType.button.size,
        lineHeight: lh(abudType.button.lineHeight),
        fontWeight: abudType.button.weight,
        letterSpacing: abudType.button.letterSpacing,
        textTransform: "none",
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: t.background,
            color: t.textPrimary,
          },
          "::selection": {
            background: t.primaryMuted,
            color: t.textPrimary,
          },
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            background: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.20)",
            borderRadius: 8,
            border: "2px solid transparent",
            backgroundClip: "content-box",
          },
          "*::-webkit-scrollbar-thumb:hover": {
            background: isDark ? "rgba(255,255,255,0.24)" : "rgba(0,0,0,0.32)",
            backgroundClip: "content-box",
          },
          // A single visible focus treatment across the whole product. Kept as
          // an outline rather than a shadow so it survives on any background,
          // including inside a selected navigation item.
          ":focus-visible": {
            outline: `2px solid ${t.focus}`,
            outlineOffset: 2,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: abudRadius.lg,
            backgroundImage: "none",
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: { padding: 20, "&:last-child": { paddingBottom: 20 } },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: abudRadius.sm, minHeight: 40, paddingInline: 16 },
          containedPrimary: {
            backgroundColor: t.primary,
            // Glow is reserved for primary actions, the selected nav item and
            // important status - it is a signal, not decoration.
            boxShadow: isDark ? `0 6px 18px ${t.primaryMuted}` : "none",
            "&:hover": {
              backgroundColor: t.primaryHover,
              boxShadow: isDark ? `0 8px 24px ${t.primaryMuted}` : "none",
            },
          },
          outlined: {
            borderColor: t.borderStrong,
            "&:hover": { borderColor: t.primary, backgroundColor: t.primaryMuted },
          },
          text: {
            "&:hover": { backgroundColor: t.surfaceHover },
          },
          sizeSmall: { minHeight: 34, fontSize: abudType.caption.size },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { "&:hover": { backgroundColor: t.surfaceHover } },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: abudRadius.pill,
            fontWeight: 600,
            fontSize: abudType.caption.size,
            height: 26,
          },
          outlined: { borderColor: t.borderStrong },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? t.backgroundAlt : "#FFFFFF",
            borderRadius: abudRadius.sm,
            fontSize: abudType.body.size,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: t.border },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: t.borderStrong },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: t.primary,
              borderWidth: 2,
            },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { fontSize: abudType.bodySmall.size } },
      },
      MuiFormHelperText: {
        styleOverrides: { root: { fontSize: abudType.caption.size, marginInlineStart: 2 } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: t.border, fontSize: abudType.bodySmall.size, paddingBlock: 12 },
          head: {
            color: t.textSecondary,
            fontWeight: abudType.label.weight,
            fontSize: abudType.label.size,
            letterSpacing: abudType.label.letterSpacing,
            backgroundColor: t.backgroundAlt,
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { "&:hover": { backgroundColor: t.surfaceHover } },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: t.border } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: t.surfaceElevated,
            border: `1px solid ${t.borderStrong}`,
            color: t.textPrimary,
            fontSize: abudType.caption.size,
            padding: "8px 10px",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: t.surfaceElevated,
            borderRadius: abudRadius.lg,
            boxShadow: t.shadow,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: abudRadius.md,
            border: `1px solid ${t.border}`,
            fontSize: abudType.bodySmall.size,
          },
          standardSuccess: { backgroundColor: t.successMuted, color: t.textPrimary },
          standardWarning: { backgroundColor: t.warningMuted, color: t.textPrimary },
          standardError: { backgroundColor: t.dangerMuted, color: t.textPrimary },
          standardInfo: { backgroundColor: t.secondaryMuted, color: t.textPrimary },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: abudRadius.pill, height: 8, backgroundColor: t.surfaceHover },
          bar: { borderRadius: abudRadius.pill },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: { backgroundColor: t.surfaceHover },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 44 },
          indicator: { height: 2, borderRadius: 2, backgroundColor: t.primary },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 44,
            textTransform: "none",
            fontWeight: 600,
            fontSize: abudType.bodySmall.size,
            color: t.textSecondary,
            "&.Mui-selected": { color: t.textPrimary },
          },
        },
      },
      MuiAccordion: {
        defaultProps: { elevation: 0, disableGutters: true },
        styleOverrides: {
          root: {
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: abudRadius.md,
            "&::before": { display: "none" },
          },
        },
      },
    },
  });
}

export const abudTheme = buildAbudTheme("dark");
