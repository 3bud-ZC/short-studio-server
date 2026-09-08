import React from "react";
import { Box, Stack, Typography, useTheme } from "@mui/material";

/**
 * Short Studio identity mark.
 *
 * Drawn as inline SVG from primitives - a lightning bolt in the product's own
 * violet. Nothing here is downloaded or traced from third-party branding.
 */
export const AbudLightning: React.FC<{ size?: number; glow?: boolean }> = ({
  size = 28,
  glow = true,
}) => {
  const theme = useTheme();
  const t = theme.abud;
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: `${Math.round(size * 0.3)}px`,
        background: `linear-gradient(145deg, ${t.primary} 0%, ${t.secondary} 140%)`,
        boxShadow: glow ? `0 0 18px ${t.primaryMuted}` : "none",
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.56}
        height={size * 0.56}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M13.6 2 4.8 13.2h5.2L9.2 22l9.2-11.6h-5.4L13.6 2Z" fill="#FFFFFF" />
      </svg>
    </Box>
  );
};

/**
 * Product wordmark. `subtitle` is the client-facing descriptor - never an
 * internal name like "Control Plane".
 */
export const AbudWordmark: React.FC<{
  size?: number;
  subtitle?: string | null;
  onClick?: () => void;
}> = ({ size = 30, subtitle = "Video Production Engine", onClick }) => {
  const theme = useTheme();
  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      onClick={onClick}
      sx={{
        cursor: onClick ? "pointer" : "default",
        minWidth: 0,
        userSelect: "none",
      }}
    >
      <AbudLightning size={size} />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="h6"
          lineHeight={1.1}
          sx={{ fontWeight: 700, letterSpacing: "-0.01em", color: theme.abud.textPrimary }}
          noWrap
        >
          Short Studio
        </Typography>
        {subtitle && (
          <Typography
            variant="caption"
            sx={{ color: theme.abud.textSecondary, display: "block", lineHeight: 1.2 }}
            noWrap
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </Stack>
  );
};

export default AbudWordmark;
