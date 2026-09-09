import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import {
  LoadingState,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../components/v2";
import UpdateCenter from "../components/UpdateCenter";
import PublicAddressPanel from "../components/PublicAddressPanel";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { LocalVoicePanel } from "../components/LocalVoicePanel";
import { useI18n } from "../i18n";

const SettingsPage: React.FC = () => {
  const { t: tr, format } = useI18n();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<any>(null);
  const [draft, setDraft] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([axios.get("/api/v2/settings")])
      .then(([settingsResponse]) => {
        setSettings(settingsResponse.data);
        setDraft(settingsResponse.data.settings || {});
      })
      .catch(() => setError(tr("settings.loadFailed")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.put("/api/v2/settings", draft);
      setDraft(response.data.settings || {});
      setMessage(tr("settings.saved"));
    } catch (err: any) {
      setError(err?.response?.data?.error || tr("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label={tr("settings.loading")} />;

  const integrationStatus = (configured?: boolean) => (configured ? "configured" : "not_configured");

  return (
    <>
      <PageHeader
        title={tr("settings.title")}
        eyebrow={tr("settings.eyebrow")}
        description={tr("settings.description")}
        actions={
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={saving}
            onClick={save}
          >
            {saving ? tr("common.saving") : tr("settings.saveDefaults")}
          </Button>
        }
      />

      {message && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        {/* V2.5.1: Production Defaults is gone. Every production picks its own
            language, length, shape, quality, voice and media on one page, so a
            second copy of those controls here could only ever disagree with it.
            What replaces it is what a customer actually operates: the language
            they read the product in, and the local voice their Arabic
            productions depend on. */}
        <Grid item xs={12} lg={6}>
          <SectionCard
            title={tr("settings.language.title")}
            description={tr("settings.language.description")}
          >
            <LanguageSwitcher />
          </SectionCard>
        </Grid>

        <Grid item xs={12} lg={6}>
          <SectionCard title={tr("settings.localVoice.title")}>
            <LocalVoicePanel />
          </SectionCard>
        </Grid>

        {/* Secure Provider Credentials Summary */}
        <Grid item xs={12} lg={5}>
          <SectionCard
            title={tr("settings.integrations.title")}
            description={tr("settings.integrations.description")}
          >
            <Stack spacing={1.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>{tr("settings.integrations.pexels")}</Typography>
                <StatusBadge status={integrationStatus(settings?.pexels?.configured)} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {tr("settings.integrations.key", {
                  value: settings?.pexels?.redactedKey || tr("settings.integrations.notConfigured"),
                })}
              </Typography>

              <Divider />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>{tr("settings.integrations.gemini")}</Typography>
                <StatusBadge
                  status={settings?.gemini?.configured ? "configured" : "not_configured"}
                  label={settings?.gemini?.configured ? undefined : tr("settings.integrations.localAiFallback")}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {tr("settings.integrations.key", {
                  value:
                    settings?.gemini?.redactedKey || tr("settings.integrations.notConfiguredLocalAi"),
                })}
              </Typography>

              <Divider />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>{tr("settings.integrations.uploadPost")}</Typography>
                <StatusBadge status={integrationStatus(settings?.uploadPost?.configured)} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {tr("settings.integrations.key", {
                  value: settings?.uploadPost?.redactedKey || tr("settings.integrations.notConfigured"),
                })}
              </Typography>

            </Stack>
          </SectionCard>
        </Grid>

        {/* Publishing & Distribution Defaults */}
        <Grid item xs={12}>
          <SectionCard
            title={tr("settings.publishing.title")}
            description={tr("settings.publishing.description")}
          >
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>{tr("settings.field.publishingMode")}</InputLabel>
                  <Select
                    label={tr("settings.field.publishingMode")}
                    value={draft.defaultPublishingMode || "draft"}
                    onChange={(e) => setDraft({ ...draft, defaultPublishingMode: e.target.value })}
                  >
                    <MenuItem value="draft">{tr("settings.field.publishingModeDraft")}</MenuItem>
                    <MenuItem value="scheduled">{tr("settings.field.publishingModeScheduled")}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>{tr("settings.field.youtubePrivacy")}</InputLabel>
                  <Select
                    label={tr("settings.field.youtubePrivacy")}
                    value={draft.defaultYouTubePrivacy || "unlisted"}
                    onChange={(e) => setDraft({ ...draft, defaultYouTubePrivacy: e.target.value })}
                  >
                    <MenuItem value="unlisted">{tr("settings.field.youtubeUnlisted")}</MenuItem>
                    <MenuItem value="private">{tr("settings.field.youtubePrivate")}</MenuItem>
                    <MenuItem value="public">{tr("settings.field.youtubePublic")}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>{tr("settings.field.timezone")}</InputLabel>
                  <Select
                    label={tr("settings.field.timezone")}
                    value={draft.defaultTimezone || "Africa/Cairo"}
                    onChange={(e) => setDraft({ ...draft, defaultTimezone: e.target.value })}
                  >
                    <MenuItem value="Africa/Cairo">Africa/Cairo (EET)</MenuItem>
                    <MenuItem value="UTC">UTC</MenuItem>
                    <MenuItem value="Asia/Riyadh">Asia/Riyadh (AST)</MenuItem>
                    <MenuItem value="Asia/Dubai">Asia/Dubai (GST)</MenuItem>
                    <MenuItem value="Europe/London">Europe/London (GMT/BST)</MenuItem>
                    <MenuItem value="America/New_York">America/New_York (EST/EDT)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {/* V2.5.1: Access tokens are not a customer concern. This product runs
            as LOCAL_SINGLE_USER on the owner's own machine; an application
            token is something a developer wiring an external system needs, not
            something the person making videos should have to understand. The
            manager still exists and still works - it lives on the technical
            surface at /providers/technical. Internal service authentication is
            unchanged. */}

        <Grid item xs={12}>
          <SectionCard
            title={tr("settings.account.title")}
            description={tr("settings.account.description")}
          >
            <AccountSecurityManager />
          </SectionCard>
        </Grid>

        {/* Updates. Client-facing: version, channel, status, release notes and
            the one action that installs an update on this platform. */}
        <Grid item xs={12}>
          <SectionCard
            title={tr("settings.updates.title")}
            description={tr("settings.updates.description")}
          >
            <UpdateCenter />
          </SectionCard>
        </Grid>

        {/* The address this installation serves. OAuth callbacks follow it. */}
        <Grid item xs={12}>
          <SectionCard
            title={tr("settings.publicAddress.title")}
            description={tr("settings.publicAddress.description")}
          >
            <PublicAddressPanel />
          </SectionCard>
        </Grid>

        <Grid item xs={12}>
          <SectionCard
            title={tr("settings.backup.title")}
            description={tr("settings.backup.description")}
            actions={
              <Button
                variant="outlined"
                size="small"
                onClick={async () => {
                  try {
                    const res = await axios.get("/api/v2/config/export");
                    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `short_studio_config_export_${Date.now()}.json`;
                    a.click();
                  } catch {
                    setError(tr("settings.backup.exportFailed"));
                  }
                }}
              >
                {tr("settings.backup.exportConfig")}
              </Button>
            }
          >
            <BackupManager />
          </SectionCard>
        </Grid>

        {/* Two shortcuts rather than two more copies of a control. Providers and
            System Health are whole pages; Settings points at them. */}
        <Grid item xs={12} md={6}>
          <SectionCard
            title={tr("settings.integrationsShortcut.title")}
            description={tr("settings.integrationsShortcut.description")}
          >
            <Button variant="outlined" onClick={() => navigate("/integrations")}>
              {tr("settings.integrationsShortcut.open")}
            </Button>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard
            title={tr("settings.diagnostics.title")}
            description={tr("settings.diagnostics.description")}
          >
            <Button variant="outlined" onClick={() => navigate("/system")}>
              {tr("settings.diagnostics.open")}
            </Button>
          </SectionCard>
        </Grid>

        {/* System & Storage Stats */}
        <Grid item xs={12} md={4}>
          <StatCard
            label={tr("settings.stat.v2Runtime")}
            value={settings?.app?.v2Enabled ? tr("settings.stat.active") : tr("settings.stat.inactive")}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard
            label={tr("settings.stat.environment")}
            value={settings?.app?.docker ? tr("settings.stat.containerized") : tr("settings.stat.native")}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard
            label={tr("settings.stat.videoStorage")}
            value={
              typeof settings?.storage?.bytes === "number"
                ? format.bytes(settings.storage.bytes)
                : tr("common.unknown")
            }
          />
        </Grid>
      </Grid>
    </>
  );
};


const BackupManager: React.FC = () => {
  const { t: tr, format } = useI18n();
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/v2/backups");
      setBackups(res.data.backups || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCreateBackup = async (type: string) => {
    setCreating(true);
    setStatusMsg(null);
    try {
      const res = await axios.post("/api/v2/backups", { type });
      setStatusMsg(tr("settings.backup.created", { name: res.data.backup.filename }));
      loadBackups();
    } catch {
      setStatusMsg(tr("settings.backup.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!window.confirm(tr("settings.backup.restoreConfirm"))) {
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`/api/v2/backups/${id}/restore`);
      alert(res.data.message || tr("settings.backup.restored"));
      loadBackups();
    } catch (err: any) {
      alert(err.response?.data?.message || tr("settings.backup.restoreFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(tr("settings.backup.deleteConfirm"))) return;
    try {
      await axios.delete(`/api/v2/backups/${id}`);
      loadBackups();
    } catch {
      alert(tr("settings.backup.deleteFailed"));
    }
  };

  const backupTypeLabel = (type: string) =>
    type === "full"
      ? tr("settings.backup.typeFull")
      : type === "config_db"
        ? tr("settings.backup.typeDbConfig")
        : tr("settings.backup.typeConfig");

  return (
    <Stack spacing={2}>
      {statusMsg && <Alert severity="info">{statusMsg}</Alert>}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" gap={1}>
        <Button
          variant="contained"
          size="small"
          disabled={creating}
          onClick={() => handleCreateBackup("config_db")}
        >
          {creating ? tr("settings.backup.creating") : tr("settings.backup.createDbConfig")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={creating}
          onClick={() => handleCreateBackup("full")}
        >
          {tr("settings.backup.createFull")}
        </Button>
      </Stack>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>
        {tr("settings.backup.history", { count: backups.length })}
      </Typography>

      {backups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {tr("settings.backup.empty")}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {backups.map((b) => (
            <Box
              key={b.id}
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 1,
                p: 1.5,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                bgcolor: "background.paper",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} dir="ltr" sx={{ textAlign: "start", wordBreak: "break-all" }}>
                  {b.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {format.dateTime(b.createdAt)} · {backupTypeLabel(b.type)} ·{" "}
                  {format.bytes(b.sizeBytes)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  dir="ltr"
                  sx={{ display: "block", wordBreak: "break-all", textAlign: "start" }}
                >
                  {tr("settings.backup.versionLine", { version: b.version })}
                  {b.manifest?.schemaVersion
                    ? tr("settings.backup.schemaSuffix", { schema: b.manifest.schemaVersion })
                    : ""}
                  {b.checksumSha256 && b.checksumSha256 !== "local"
                    ? ` · SHA-256 ${String(b.checksumSha256).slice(0, 16)}…`
                    : ""}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="text" href={`/api/v2/backups/${b.id}/download`}>
                  {tr("common.download")}
                </Button>
                <Button size="small" variant="outlined" color="warning" onClick={() => handleRestore(b.id)}>
                  {tr("settings.backup.restore")}
                </Button>
                <Button size="small" variant="text" color="error" onClick={() => handleDelete(b.id)}>
                  {tr("common.delete")}
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

const AccountSecurityManager: React.FC = () => {
  const { t: tr } = useI18n();
  const [me, setMe] = useState<{ username: string; accessMode?: "local"; remoteAccess?: "disabled" } | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<{ text: string; severity: "success" | "error" } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; severity: "success" | "error" } | null>(null);
  const [sessionsMsg, setSessionsMsg] = useState<{ text: string; severity: "success" | "error" } | null>(null);

  const load = async () => {
    try {
      const meRes = await axios.get("/api/v2/auth/me");
      const user = meRes.data.user;
      setMe(user);
      if (user?.accessMode === "local") {
        setSessionCount(0);
        return;
      }
      const sessionsRes = await axios.get("/api/v2/auth/sessions");
      setSessionCount((sessionsRes.data.sessions || []).length);
    } catch {
      // The page's own auth redirect handles a missing/expired session.
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameMsg(null);
    setUsernameBusy(true);
    try {
      const res = await axios.post("/api/v2/auth/change-username", { username: newUsername });
      setNewUsername("");
      setUsernameMsg({ text: tr("settings.account.usernameUpdated"), severity: "success" });
      setMe({ username: res.data.username });
    } catch (err: any) {
      setUsernameMsg({
        text: err.response?.data?.error || tr("settings.account.updateFailed"),
        severity: "error",
      });
    } finally {
      setUsernameBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: tr("settings.account.passwordMismatch"), severity: "error" });
      return;
    }
    setPasswordBusy(true);
    try {
      await axios.post("/api/v2/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({ text: tr("settings.account.passwordUpdated"), severity: "success" });
    } catch (err: any) {
      setPasswordMsg({
        text: err.response?.data?.error || tr("settings.account.updateFailed"),
        severity: "error",
      });
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleSignOutOtherSessions = async () => {
    setSessionsBusy(true);
    setSessionsMsg(null);
    try {
      const res = await axios.post("/api/v2/auth/sessions/revoke-others");
      setSessionsMsg({
        text: tr("settings.account.otherSessionsRevoked", { count: res.data.revoked ?? 0 }),
        severity: "success",
      });
      load();
    } catch {
      setSessionsMsg({ text: tr("settings.account.updateFailed"), severity: "error" });
    } finally {
      setSessionsBusy(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await axios.post("/api/v2/auth/logout");
    } finally {
      localStorage.removeItem("abud_session_token");
      window.location.assign("/login");
    }
  };

  return (
    <Stack spacing={3}>
      {me?.accessMode === "local" && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {tr("settings.account.localAccessMode")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tr("settings.account.localRemoteAccess")}
          </Typography>
        </Stack>
      )}

      {me?.accessMode === "local" ? null : (
        <>
      {me && (
        <Typography variant="body2" color="text.secondary">
          {tr("settings.account.currentUsername", { username: me.username })}
        </Typography>
      )}

      <Box component="form" onSubmit={handleChangeUsername}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>
            {tr("settings.account.changeUsername")}
          </Typography>
          {usernameMsg && <Alert severity={usernameMsg.severity}>{usernameMsg.text}</Alert>}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" gap={1}>
            <TextField
              label={tr("settings.account.newUsername")}
              size="small"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="username"
            />
            <Button type="submit" variant="outlined" size="small" disabled={usernameBusy || !newUsername}>
              {tr("settings.account.changeUsername")}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Divider />

      <Box component="form" onSubmit={handleChangePassword}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>
            {tr("settings.account.changePassword")}
          </Typography>
          {passwordMsg && <Alert severity={passwordMsg.severity}>{passwordMsg.text}</Alert>}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" gap={1}>
            <TextField
              label={tr("settings.account.currentPassword")}
              type="password"
              size="small"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <TextField
              label={tr("settings.account.newPassword")}
              type="password"
              size="small"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <TextField
              label={tr("settings.account.confirmPassword")}
              type="password"
              size="small"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Button
              type="submit"
              variant="outlined"
              size="small"
              disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
            >
              {tr("settings.account.changePassword")}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Divider />

      <Stack spacing={1.5}>
        <Typography variant="subtitle2" fontWeight={700}>
          {tr("settings.account.sessions", { count: sessionCount })}
        </Typography>
        {sessionsMsg && <Alert severity={sessionsMsg.severity}>{sessionsMsg.text}</Alert>}
        <Stack direction="row" spacing={1.5} flexWrap="wrap" gap={1}>
          <Button variant="outlined" size="small" disabled={sessionsBusy} onClick={handleSignOutOtherSessions}>
            {tr("settings.account.signOutOtherSessions")}
          </Button>
          <Button variant="text" color="error" size="small" onClick={handleSignOut}>
            {tr("settings.account.signOut")}
          </Button>
        </Stack>
      </Stack>
        </>
      )}
    </Stack>
  );
};

export default SettingsPage;
