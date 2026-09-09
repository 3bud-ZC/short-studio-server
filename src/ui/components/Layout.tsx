import React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { CacheProvider } from "@emotion/react";
import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Drawer,
  IconButton,
  Stack,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/SpaceDashboardOutlined";
import AddIcon from "@mui/icons-material/AddCircleOutline";
import WorkIcon from "@mui/icons-material/MovieFilterOutlined";
import VideoIcon from "@mui/icons-material/VideoLibraryOutlined";
import BusinessIcon from "@mui/icons-material/StorefrontOutlined";
import ViewModuleIcon from "@mui/icons-material/DashboardCustomizeOutlined";
import HubIcon from "@mui/icons-material/ExtensionOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import MonitorHeartIcon from "@mui/icons-material/FavoriteBorderOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import SendIcon from "@mui/icons-material/SendOutlined";
import CircleIcon from "@mui/icons-material/Circle";
import PermMediaIcon from "@mui/icons-material/PermMediaOutlined";

import { buildAbudTheme } from "../theme/abudTheme";
import { getDirectionCache } from "../theme/directionCache";
import { AbudWordmark } from "./AbudMark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "../i18n";

interface LayoutProps {
  children: React.ReactNode;
}

const drawerWidth = 268;

/**
 * Client-facing navigation.
 *
 * Grouped by what the customer is trying to do, not by how the engine is built.
 * n8n, PostgreSQL, the render worker and the internal service token are
 * deliberately absent: they are implementation, and the customer never has to
 * know they exist.
 *
 * Labels are translation keys rather than literals so the whole menu changes
 * language with the rest of the product.
 */
const navSections: Array<{
  labelKey: string;
  items: Array<{ labelKey: string; path: string; icon: React.ReactNode }>;
}> = [
  {
    labelKey: "",
    items: [{ labelKey: "navigation.dashboard", path: "/", icon: <DashboardIcon /> }],
  },
  {
    labelKey: "navigation.groupCreate",
    items: [
      { labelKey: "navigation.createVideo", path: "/create", icon: <AddIcon /> },
      { labelKey: "navigation.productions", path: "/jobs", icon: <WorkIcon /> },
      { labelKey: "navigation.videoLibrary", path: "/videos", icon: <VideoIcon /> },
    ],
  },
  {
    labelKey: "navigation.groupContent",
    items: [
      { labelKey: "navigation.templates", path: "/templates", icon: <ViewModuleIcon /> },
      { labelKey: "navigation.media", path: "/media", icon: <PermMediaIcon /> },
    ],
  },
  {
    labelKey: "navigation.groupDistribute",
    items: [{ labelKey: "navigation.publishing", path: "/publishing", icon: <SendIcon /> }],
  },
  {
    labelKey: "navigation.groupConfigure",
    items: [
      { labelKey: "navigation.integrations", path: "/integrations", icon: <HubIcon /> },
      { labelKey: "navigation.settings", path: "/settings", icon: <SettingsIcon /> },
    ],
  },
  {
    labelKey: "navigation.groupSystem",
    items: [{ labelKey: "navigation.systemHealth", path: "/system", icon: <MonitorHeartIcon /> }],
  },
];

/** Browser tab title per route, as a translation key. */
const pageTitleKeys: Record<string, string> = {
  "/": "navigation.dashboard",
  "/create": "navigation.createVideo",
  "/jobs": "navigation.productions",
  "/videos": "navigation.videoLibrary",
  "/media": "navigation.media",
  "/publishing": "navigation.publishing",
  "/templates": "navigation.templates",
  "/integrations": "navigation.integrations",
  "/providers": "navigation.integrations",
  "/settings": "navigation.settings",
  "/system": "navigation.systemHealth",
  "/setup": "navigation.setup",
  "/login": "navigation.signIn",
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, direction } = useI18n();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const theme = React.useMemo(() => buildAbudTheme("dark", direction), [direction]);
  const cache = React.useMemo(() => getDirectionCache(direction), [direction]);
  const tokens = theme.abud;

  React.useEffect(() => {
    const exactKey = pageTitleKeys[location.pathname];
    const dynamicKey = location.pathname.startsWith("/jobs/")
      ? "navigation.productionDetails"
      : location.pathname.startsWith("/video/")
        ? "navigation.videoDetails"
        : exactKey;
    const title = dynamicKey ? t(dynamicKey) : t("common.appName");
    document.title = `${title} · ${t("common.appName")}`;
  }, [location.pathname, t]);

  // Login and Setup are full-bleed: no shell, no navigation to get lost in.
  if (location.pathname === "/login") {
    return (
      <CacheProvider value={cache}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Box sx={{ minHeight: "100vh", bgcolor: "background.default", px: 2 }}>{children}</Box>
        </ThemeProvider>
      </CacheProvider>
    );
  }

  const drawer = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: tokens.backgroundAlt,
      }}
    >
      <Toolbar sx={{ minHeight: 88, alignItems: "center", px: 2.5 }}>
        <AbudWordmark subtitle={t("common.appTagline")} onClick={() => navigate("/")} />
      </Toolbar>

      <Box
        component="nav"
        aria-label={t("common.mainNavigation")}
        sx={{ px: 1.5, pb: 2, overflowY: "auto" }}
      >
        <Stack spacing={1.5}>
          {navSections.map((section, sectionIndex) => (
            <Box key={section.labelKey || `section-${sectionIndex}`}>
              {section.labelKey && (
                <Typography
                  variant="overline"
                  component="div"
                  // Section headings are small uppercase text, so they take the
                  // secondary colour rather than the muted one: muted is for
                  // genuinely de-emphasised values, not for a heading someone
                  // has to read.
                  sx={{ px: 1.5, py: 0.75, color: tokens.textSecondary, display: "block" }}
                >
                  {t(section.labelKey)}
                </Typography>
              )}
              <Stack spacing={0.25} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {section.items.map((item) => (
                  <li key={item.path}>
                    <Button
                      component={NavLink}
                      to={item.path}
                      end={item.path === "/" ? true : undefined}
                      startIcon={item.icon}
                      fullWidth
                      onClick={() => setMobileOpen(false)}
                      sx={{
                        // `flex-start` plus logical icon spacing keeps the icon
                        // on the leading edge in both directions.
                        justifyContent: "flex-start",
                        textAlign: "start",
                        minHeight: 44,
                        px: 1.5,
                        fontWeight: 500,
                        color: tokens.textSecondary,
                        borderRadius: 2,
                        "& .MuiButton-startIcon": {
                          color: "inherit",
                          minWidth: 24,
                          marginInlineEnd: 1.25,
                          marginInlineStart: 0,
                        },
                        "&:hover": { bgcolor: tokens.surfaceHover, color: tokens.textPrimary },
                        "&.active": {
                          bgcolor: tokens.primaryMuted,
                          color: tokens.textPrimary,
                          fontWeight: 600,
                          // A leading-edge rule marks the selected item. Written
                          // with a logical border so it moves to the right-hand
                          // edge in Arabic without a second rule.
                          borderInlineStartWidth: 2,
                          borderInlineStartStyle: "solid",
                          borderInlineStartColor: tokens.primary,
                          "& .MuiButton-startIcon": { color: tokens.primary },
                        },
                      }}
                    >
                      {t(item.labelKey)}
                    </Button>
                  </li>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box sx={{ mt: "auto", px: 2, pb: 2, pt: 1 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 0.5 }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <CircleIcon sx={{ fontSize: 8, color: tokens.success }} aria-hidden="true" />
            <Typography variant="caption" sx={{ color: tokens.textSecondary }} noWrap>
              {t("common.allServicesRunning")}
            </Typography>
          </Stack>
          <LanguageSwitcher compact />
        </Stack>
        <Tooltip title={t("common.setupGuide")}>
          <Button
            size="small"
            variant="text"
            onClick={() => navigate("/setup")}
            sx={{ fontSize: "0.78rem", px: 1, minWidth: 0, minHeight: 30, color: tokens.textSecondary }}
          >
            {t("common.setupGuide")}
          </Button>
        </Tooltip>
      </Box>
    </Box>
  );

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: tokens.background }}>
          <AppBar
            position="fixed"
            elevation={0}
            sx={{
              display: { md: "none" },
              bgcolor: tokens.backgroundAlt,
              borderBottom: `1px solid ${tokens.border}`,
              backgroundImage: "none",
            }}
          >
            <Toolbar sx={{ gap: 1 }}>
              <IconButton
                aria-label={t("common.openNavigation")}
                edge="start"
                onClick={() => setMobileOpen(true)}
                sx={{ color: tokens.textPrimary }}
              >
                <MenuIcon />
              </IconButton>
              <AbudWordmark size={26} subtitle={null} onClick={() => navigate("/")} />
              <Box sx={{ flexGrow: 1 }} />
              <LanguageSwitcher compact />
            </Toolbar>
          </AppBar>

          <Box component="div" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
            <Drawer
              variant="temporary"
              // No explicit anchor: MUI already resolves the default `left`
              // against `theme.direction`, so the drawer lands on the leading
              // edge in both languages. Passing "right" for RTL flips it a
              // second time and puts the sidebar back on the wrong side.
              open={mobileOpen}
              onClose={() => setMobileOpen(false)}
              ModalProps={{ keepMounted: true }}
              sx={{
                display: { xs: "block", md: "none" },
                "& .MuiDrawer-paper": {
                  width: drawerWidth,
                  boxSizing: "border-box",
                  bgcolor: tokens.backgroundAlt,
                  borderInlineEndWidth: 1,
                  borderInlineEndStyle: "solid",
                  borderInlineEndColor: tokens.border,
                },
              }}
            >
              {drawer}
            </Drawer>
            <Drawer
              variant="permanent"
              open
              sx={{
                display: { xs: "none", md: "block" },
                "& .MuiDrawer-paper": {
                  width: drawerWidth,
                  boxSizing: "border-box",
                  bgcolor: tokens.backgroundAlt,
                  borderInlineEndWidth: 1,
                  borderInlineEndStyle: "solid",
                  borderInlineEndColor: tokens.border,
                },
              }}
            >
              {drawer}
            </Drawer>
          </Box>

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              width: { xs: "100%", md: `calc(100% - ${drawerWidth}px)` },
              pt: { xs: 10, md: 4 },
              pb: 6,
              px: { xs: 2, sm: 3, lg: 4 },
              minWidth: 0,
              // A subtle violet wash at the leading top corner; nowhere near
              // body text. Mirrored so it stays in the corner nearest the
              // sidebar in both directions.
              backgroundImage: `radial-gradient(1200px 380px at ${
                direction === "rtl" ? "78%" : "22%"
              } -12%, ${tokens.primaryMuted} 0%, transparent 70%)`,
            }}
          >
            <Box sx={{ width: "100%", maxWidth: 1560, mx: "auto", minWidth: 0 }}>{children}</Box>
          </Box>
        </Box>
      </ThemeProvider>
    </CacheProvider>
  );
};

export default Layout;
