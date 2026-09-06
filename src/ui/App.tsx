import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import VideoList from "./pages/VideoList";
import VideoCreator from "./pages/VideoCreator";
import VideoDetails from "./pages/VideoDetails";
import Layout from "./components/Layout";
import DashboardHome from "./pages/DashboardHome";
import JobsPage from "./pages/JobsPage";
import JobDetails from "./pages/JobDetails";
import SystemPage from "./pages/SystemPage";
import ProvidersPage from "./pages/ProvidersPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import MediaPage from "./pages/MediaPage";
import BrandsPage from "./pages/BrandsPage";
import TemplatesPage from "./pages/TemplatesPage";
import SettingsPage from "./pages/SettingsPage";
import PublishingPage from "./pages/PublishingPage";
import SetupWizard from "./pages/SetupWizard";
import LoginPage from "./pages/LoginPage";
import { Button } from "@mui/material";
import { EmptyState, ErrorBoundary, PageHeader } from "./components/v2";
import { I18nProvider, useI18n } from "./i18n";

import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { getSessionToken, isLocalSingleUserBrowserOwner } from "./utils/auth";

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = getSessionToken();
  const location = useLocation();
  const [access, setAccess] = React.useState<"checking" | "local" | "anonymous">(
    token ? "local" : "checking",
  );

  React.useEffect(() => {
    let cancelled = false;
    if (token) {
      setAccess("local");
      return;
    }
    setAccess("checking");
    isLocalSingleUserBrowserOwner()
      .then((isLocal) => {
        if (!cancelled) setAccess(isLocal ? "local" : "anonymous");
      })
      .catch(() => {
        if (!cancelled) setAccess("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (access === "checking") {
    return null;
  }

  if (access === "anonymous") {
    try {
      localStorage.setItem("abud_auth_return_to", `${location.pathname}${location.search}`);
    } catch {
      // Ignore storage errors
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const LoginRoute: React.FC = () => {
  const [access, setAccess] = React.useState<"checking" | "local" | "secure">("checking");

  React.useEffect(() => {
    let cancelled = false;
    isLocalSingleUserBrowserOwner()
      .then((isLocal) => {
        if (!cancelled) setAccess(isLocal ? "local" : "secure");
      })
      .catch(() => {
        if (!cancelled) setAccess("secure");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (access === "checking") return null;
  return access === "local" ? <Navigate to="/" replace /> : <LoginPage />;
};

/** Shown for any path the router does not recognise. */
const NotFoundPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, format } = useI18n();
  return (
    <>
      <PageHeader title={t("common.pageNotFound")} description={t("common.pageNotFoundBody")} />
      <EmptyState
        // The path is a URL fragment, so it is isolated: an Arabic interface
        // must not reorder the slashes in "/videos/abc".
        title={t("common.nothingAtPath", { path: format.technical(location.pathname) })}
        description={t("common.nothingAtPathBody")}
        action={
          <Button variant="contained" onClick={() => navigate("/")}>
            {t("common.goToDashboard")}
          </Button>
        }
      />
    </>
  );
};

const App: React.FC = () => {
  return (
    // The interface language wraps the whole application, including the
    // router, so the shell resolves its direction before the first route
    // renders and the layout never flips after paint.
    <I18nProvider>
      <Router>
        <Layout>
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/setup" element={<SetupWizard />} />

              <Route path="/" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
              <Route path="/create" element={<ProtectedRoute><VideoCreator /></ProtectedRoute>} />
              <Route path="/jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
              <Route path="/jobs/:jobId" element={<ProtectedRoute><JobDetails /></ProtectedRoute>} />
              <Route path="/jobs/:id" element={<ProtectedRoute><JobDetails /></ProtectedRoute>} />
              <Route path="/videos" element={<ProtectedRoute><VideoList /></ProtectedRoute>} />
              <Route path="/video/:videoId" element={<ProtectedRoute><VideoDetails /></ProtectedRoute>} />
              <Route path="/publishing" element={<ProtectedRoute><PublishingPage /></ProtectedRoute>} />
              <Route path="/brands" element={<ProtectedRoute><BrandsPage /></ProtectedRoute>} />
              <Route path="/templates" element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
              <Route path="/media" element={<ProtectedRoute><MediaPage /></ProtectedRoute>} />
              <Route path="/integrations" element={<ProtectedRoute><IntegrationsPage /></ProtectedRoute>} />
              {/* Legacy path kept so old links and bookmarks still resolve. */}
              <Route path="/providers" element={<Navigate to="/integrations" replace />} />
              <Route path="/providers/technical" element={<ProtectedRoute><ProvidersPage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/system" element={<ProtectedRoute><SystemPage /></ProtectedRoute>} />
              {/* The library lives at /videos and a single video at /video/:id, so
                  /videos/:id is an easy URL to land on by hand or from an old
                  bookmark. Without a catch-all every unmatched path rendered the
                  shell with an empty main area, which reads as a broken page. */}
              <Route path="*" element={<ProtectedRoute><NotFoundPage /></ProtectedRoute>} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </Router>
    </I18nProvider>
  );
};

export default App;
