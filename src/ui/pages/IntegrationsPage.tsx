import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import BoltIcon from "@mui/icons-material/Bolt";

import { ConfirmDialog, ErrorBoundary, LoadingState, PageHeader, SectionCard } from "../components/v2";
import { useI18n } from "../i18n";
import { localizedApiError, localizedApiMessage } from "../utils/localizedApiError";
import { statusDescriptor, type StatusTone } from "../theme/statusModel";
import {
  CLIENT_CATEGORY_ORDER,
  CLIENT_CATEGORY_KEY,
  INTEGRATION_CATALOG,
  catalogKey,
  clientCategoryFor,
  type ClientCategory,
} from "./integrationsCatalog";

type ProviderRecord = {
  id?: string;
  name: string;
  category?: string;
  tier?: string;
  status?: string;
  configured?: boolean;
  isDefault?: boolean;
  message?: string;
  checkedAt?: string;
  credentialTypes?: string[];
  vaultConfigured?: boolean;
  vault?: Array<{ credentialType: string; maskedHint?: string; health?: string; lastTestedAt?: string }>;
};

function toneIcon(tone: StatusTone) {
  if (tone === "success") return <CheckCircleIcon fontSize="small" />;
  if (tone === "warning") return <WarningAmberIcon fontSize="small" />;
  if (tone === "danger") return <ErrorOutlineIcon fontSize="small" />;
  if (tone === "info") return <BoltIcon fontSize="small" />;
  return <RadioButtonUncheckedIcon fontSize="small" />;
}

function toneColor(tone: StatusTone): "success" | "warning" | "error" | "info" | "default" {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "error";
  if (tone === "info") return "info";
  return "default";
}

/** What the Connected Accounts endpoint gives us, minus anything sensitive. */
type ConnectedAccountSummary = {
  id: string;
  platform: string;
  provider: string;
  accountName: string;
  connectionStatus: string;
};

type OAuthSetupState = {
  providerId: string;
  displayName: string;
  consoleUrl: string;
  callbackUrl: string;
  fields: Array<{ key: string; label: string; help: string }>;
  scopes: Array<{ scope: string; reason: string }>;
  configured: boolean;
  values: Record<string, string>;
  error?: string;
};

/**
 * Which platforms an OAuth provider can publish to. Used to decide whether a
 * customer account is really connected, which is a different question from
 * whether the application credentials exist.
 */
const OAUTH_PLATFORMS: Record<string, string[]> = {
  youtube: ["youtube"],
  meta: ["instagram", "facebook"],
  tiktok: ["tiktok"],
};

const IntegrationsContent: React.FC = () => {
  const theme = useTheme();
  const t = theme.abud;
  const { t: tr, format, locale } = useI18n();
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [vaultAvailable, setVaultAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const [configureTarget, setConfigureTarget] = useState<ProviderRecord | null>(null);
  /** Accounts the customer has actually connected, per platform. */
  const [accounts, setAccounts] = useState<ConnectedAccountSummary[]>([]);
  /** The OAuth app-setup dialog: which provider, and what it needs. */
  const [oauthSetup, setOauthSetup] = useState<OAuthSetupState | null>(null);
  const [oauthSaving, setOauthSaving] = useState(false);
  const [secretValue, setSecretValue] = useState("");
  const [credentialType, setCredentialType] = useState("api_key");
  const [saving, setSaving] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ProviderRecord | null>(null);

  /** "Tested {date}", or "Never tested" for a missing / unparseable value. */
  const formatWhen = (value?: string): string => {
    if (!value) return tr("integrations.neverTested");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return tr("integrations.neverTested");
    return tr("integrations.testedOn", { time: format.dateTime(date) });
  };

  /** Customer-facing label for a catalogue entry, from the active-language catalogue. */
  const catalogText = (id: string, field: "label" | "purpose" | "cost" | "keyHelp" | "default") =>
    tr(catalogKey(id, field));

  const load = async () => {
    try {
      const [providerResponse, accountResponse] = await Promise.all([
        axios.get("/api/v2/providers"),
        // Whether an account is connected is a separate fact from whether the
        // application credentials exist, so it comes from a separate source.
        axios.get("/api/v2/publishing/accounts").catch(() => ({ data: { accounts: [] } })),
      ]);
      setProviders(providerResponse.data.providers || []);
      setVaultAvailable(providerResponse.data.vault?.available !== false);
      setAccounts(accountResponse.data.accounts || []);
      setError(null);
    } catch {
      setError(tr("integrations.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /**
   * The OAuth callback returns here with a short status word. Nothing sensitive
   * travels in the URL, and the parameters are cleared once read so a refresh
   * does not repeat the message.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("connection");
    if (!outcome) return;
    if (outcome === "connected") setFeedback(tr("integrations.accountConnected"));
    else if (outcome === "cancelled") setError(tr("integrations.connectionCancelled"));
    else setError(tr("integrations.connectionFailed", {
      reason: localizedApiMessage({ message: params.get("reason") }, locale, tr("common.unknown")),
    }));
    window.history.replaceState({}, "", window.location.pathname);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Two visual sources that always work and take no credential: the customer's
   * own uploaded media, and the built-in motion-graphics engine. They have no
   * provider record because there is nothing to configure or authenticate, and
   * that is exactly why they used to be invisible on the page whose job is to
   * tell the customer what their videos can be made from. They are marked
   * healthy because they genuinely are - both are shipped with the product and
   * neither can be "unconfigured".
   */
  const builtInVisualRoutes: ProviderRecord[] = useMemo(
    () =>
      (["customer_media", "motion_graphics"] as const).map((id) => ({
        id,
        name: id,
        category: "Visuals",
        status: "healthy",
        configured: true,
        healthy: true,
      })) as unknown as ProviderRecord[],
    [],
  );

  /** Only providers the catalog knows about are shown to a customer. */
  const grouped = useMemo(() => {
    const map = new Map<ClientCategory, ProviderRecord[]>();
    CLIENT_CATEGORY_ORDER.forEach((category) => map.set(category, []));
    [...providers, ...builtInVisualRoutes].forEach((provider) => {
      if (!provider.id) return;
      const category = clientCategoryFor(provider.id);
      if (!category) return;
      map.get(category)!.push(provider);
    });
    return map;
  }, [providers, builtInVisualRoutes]);

  const runTest = async (provider: ProviderRecord) => {
    if (!provider.id) return;
    setTesting(provider.id);
    try {
      const res = await axios.post(`/api/v2/providers/${provider.id}/validate`);
      const data = res.data || {};
      const healthy = data.healthy ?? data.ok ?? data.configured ?? false;
      setTestResult((prev) => ({
        ...prev,
        [provider.id as string]: {
          ok: Boolean(healthy),
          message: localizedApiMessage(
            data,
            locale,
            healthy ? tr("integrations.testSucceeded") : tr("integrations.testDidNotSucceed"),
          ),
        },
      }));
      load();
    } catch (err: any) {
      setTestResult((prev) => ({
        ...prev,
        [provider.id as string]: {
          ok: false,
          message: localizedApiError(err, locale, tr("integrations.testFailed")),
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const openConfigure = (provider: ProviderRecord) => {
    const catalog = INTEGRATION_CATALOG[provider.id as string];
    setConfigureTarget(provider);
    setCredentialType(catalog?.credentialType || provider.credentialTypes?.[0] || "api_key");
    setSecretValue("");
  };

  const saveCredential = async () => {
    if (!configureTarget?.id || !secretValue.trim()) return;
    setSaving(true);
    try {
      await axios.put(`/api/v2/providers/${configureTarget.id}/credentials`, {
        credentialType,
        value: secretValue.trim(),
      });
      setFeedback(tr("integrations.savedSecurely", { name: catalogText(configureTarget.id, "label") }));
      setConfigureTarget(null);
      setSecretValue("");
      load();
    } catch (err: any) {
      setError(localizedApiError(err, locale, tr("integrations.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!disconnectTarget?.id) return;
    try {
      await axios.delete(`/api/v2/providers/${disconnectTarget.id}/credentials`);
      setFeedback(tr("integrations.disconnectedName", { name: catalogText(disconnectTarget.id, "label") }));
      load();
    } catch {
      setError(tr("integrations.disconnectFailed"));
    } finally {
      setDisconnectTarget(null);
    }
  };

  /**
   * Opens the no-code application setup.
   *
   * The dialog shows the exact callback URL to paste into the provider console,
   * so the customer never has to work it out or edit a file.
   */
  const openOauthSetup = async (providerId?: string) => {
    if (!providerId) return;
    try {
      const response = await axios.get(`/api/v2/providers/${providerId}/oauth/config`);
      setOauthSetup({ ...response.data, values: {} });
    } catch {
      setError(tr("integrations.setupLoadFailed"));
    }
  };

  const saveOauthApp = async () => {
    if (!oauthSetup) return;
    setOauthSaving(true);
    try {
      await axios.put(`/api/v2/providers/${oauthSetup.providerId}/oauth/app`, {
        clientId: oauthSetup.values.clientId,
        clientSecret: oauthSetup.values.clientSecret,
      });
      setOauthSetup(null);
      await load();
    } catch (err: any) {
      setOauthSetup({ ...oauthSetup, error: localizedApiError(err, locale, tr("integrations.saveFailed")) });
    } finally {
      setOauthSaving(false);
    }
  };

  /**
   * Begins account authorization.
   *
   * The endpoint returns the provider's consent URL rather than redirecting, so
   * a provider that is not configured yet can answer with a clear next step
   * instead of bouncing the customer to a broken screen.
   */
  const startOauth = async (provider: ProviderRecord) => {
    try {
      const response = await axios.get(`/api/v2/providers/${provider.id}/oauth/start`, {
        params: { returnTo: "/integrations" },
      });
      if (response.data?.authUrl) window.location.href = response.data.authUrl;
    } catch (err: any) {
      if (err?.response?.status === 409) {
        await openOauthSetup(provider.id);
        return;
      }
      setError(localizedApiError(err, locale, tr("integrations.startFailed")));
    }
  };

  /** True when a real customer account is connected for this provider. */
  const connectedAccountFor = (providerId?: string): ConnectedAccountSummary | undefined => {
    if (!providerId) return undefined;
    const platforms = OAUTH_PLATFORMS[providerId];
    if (!platforms) return undefined;
    return accounts.find(
      (account) => platforms.includes(account.platform) && account.connectionStatus === "connected",
    );
  };

  if (loading) return <LoadingState label={tr("integrations.loading")} />;

  const renderCard = (provider: ProviderRecord) => {
    const catalog = INTEGRATION_CATALOG[provider.id as string];
    if (!catalog) return null;
    const descriptor = statusDescriptor(
      provider.configured ? provider.status || "ready" : "not_configured",
    );
    const vaultEntry = provider.vault?.[0];
    // System health already exercises some providers (Pexels, for example), so
    // a passing check is real evidence even without a manual credential test.
    const healthyStatus = provider.status === "healthy" || provider.status === "ready";
    const result = testResult[provider.id as string];

    return (
      <Grid item xs={12} md={6} xl={4} key={provider.id}>
        <Card sx={{ height: "100%", display: "flex", flexDirection: "column", p: 2.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={650} noWrap>
                {catalogText(catalog.id, "label")}
              </Typography>
              <Typography variant="body2" sx={{ color: t.textSecondary, mt: 0.25 }}>
                {catalogText(catalog.id, "purpose")}
              </Typography>
            </Box>
            <Chip
              size="small"
              icon={toneIcon(descriptor.tone)}
              label={tr(descriptor.labelKey)}
              color={toneColor(descriptor.tone)}
              variant={descriptor.tone === "neutral" ? "outlined" : "filled"}
            />
          </Stack>

          <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.75 }}>
            <Chip size="small" variant="outlined" label={catalogText(catalog.id, "cost")} />
            {provider.isDefault && (
              <Chip
                size="small"
                variant="outlined"
                label={catalog.hasDefault ? catalogText(catalog.id, "default") : tr("integrations.defaultLabel")}
              />
            )}
            {catalog.optional && <Chip size="small" variant="outlined" label={tr("integrations.optional")} />}
          </Stack>

          <Typography variant="caption" sx={{ color: t.muted, mt: 1.5, display: "block" }}>
            {vaultEntry?.maskedHint
              ? `${tr("integrations.keyHint", { hint: vaultEntry.maskedHint })} · `
              : ""}
            {/* A built-in capability has no credential to test; system health
                already verifies it, so "Never tested" would be misleading.
                For everything else only a real credential test counts - the
                health-check timestamp is not a connection test. */}
            {catalog.connectionType === "builtin"
              ? tr("integrations.selfCheckPassed")
              : !provider.configured
                ? tr("integrations.notSetUp")
                : vaultEntry?.lastTestedAt
                  ? formatWhen(vaultEntry.lastTestedAt)
                  : healthyStatus
                    ? tr("integrations.workingVerified")
                    : tr("integrations.notTestedYet")}
          </Typography>

          {result && (
            <Alert severity={result.ok ? "success" : "warning"} sx={{ mt: 1.5, py: 0.5 }}>
              <Typography variant="caption">{result.message}</Typography>
            </Alert>
          )}

          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
            {catalog.connectionType === "oauth" ? (
              /* Two genuinely different steps. Configuring the application is
                 not the same as connecting an account, and collapsing them is
                 what made a provider with saved credentials and no connected
                 account read as ready. */
              <>
                <Button size="small" variant={provider.configured ? "outlined" : "contained"} onClick={() => openOauthSetup(provider.id)}>
                  {provider.configured
                    ? tr("integrations.replaceAppCredentials")
                    : tr("integrations.setUpProvider", { name: catalog.shortName })}
                </Button>
                {provider.configured && (
                  <Button size="small" variant="contained" onClick={() => startOauth(provider)}>
                    {connectedAccountFor(provider.id)
                      ? tr("integrations.reconnectAccount")
                      : tr("integrations.connectAccount")}
                  </Button>
                )}
              </>
            ) : catalog.connectionType === "key" ? (
              <Button size="small" variant="contained" onClick={() => openConfigure(provider)}>
                {provider.configured ? tr("integrations.replaceKey") : tr("common.configure")}
              </Button>
            ) : (
              <Chip size="small" variant="outlined" label={tr("integrations.builtInNothing")} />
            )}

            {catalog.connectionType !== "builtin" && (
              <Button
                size="small"
                variant="outlined"
                disabled={!provider.configured || testing === provider.id}
                onClick={() => runTest(provider)}
                startIcon={testing === provider.id ? <CircularProgress size={14} /> : undefined}
              >
                {tr("common.testConnection")}
              </Button>
            )}

            {catalog.connectionType !== "builtin" && provider.vaultConfigured && (
              <Button size="small" color="error" variant="text" onClick={() => setDisconnectTarget(provider)}>
                {tr("common.disconnect")}
              </Button>
            )}
          </Stack>
        </Card>
      </Grid>
    );
  };

  return (
    <>
      <PageHeader
        title={tr("integrations.title")}
        eyebrow={tr("integrations.eyebrow")}
        description={tr("integrations.description")}
      />

      {!vaultAvailable && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {tr("integrations.storageUnavailable")}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {feedback && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setFeedback(null)}>
          {feedback}
        </Alert>
      )}

      <Stack spacing={3}>
        {CLIENT_CATEGORY_ORDER.map((category) => {
          const items = grouped.get(category) || [];
          if (items.length === 0) return null;
          const isAdvanced = category === "Optional & Advanced";
          const categoryLabel = tr(CLIENT_CATEGORY_KEY[category]);

          const body = (
            <Grid container spacing={2}>
              {items.map(renderCard)}
            </Grid>
          );

          // Advanced capabilities are collapsed by default: a normal customer
          // never has to look at them.
          return isAdvanced ? (
            <Accordion key={category} variant="outlined">
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box>
                  <Typography fontWeight={650}>{categoryLabel}</Typography>
                  <Typography variant="body2" sx={{ color: t.textSecondary }}>
                    {tr("integrations.advancedCategoryHint")}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>{body}</AccordionDetails>
            </Accordion>
          ) : (
            <SectionCard key={category} title={categoryLabel}>
              {body}
            </SectionCard>
          );
        })}
      </Stack>

      <Dialog open={Boolean(configureTarget)} onClose={() => setConfigureTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {configureTarget
            ? tr("integrations.configureTitle", { name: catalogText(configureTarget.id as string, "label") })
            : ""}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: t.textSecondary, mb: 2 }}>
            {configureTarget ? catalogText(configureTarget.id as string, "keyHelp") : ""}
          </Typography>
          <TextField
            fullWidth
            autoFocus
            type="password"
            label={
              credentialType === "service_account_json"
                ? tr("integrations.serviceAccountJson")
                : tr("integrations.apiKey")
            }
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
            multiline={credentialType === "service_account_json"}
            minRows={credentialType === "service_account_json" ? 4 : undefined}
            placeholder={tr("integrations.pastePlaceholder")}
            helperText={tr("integrations.storedEncrypted")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigureTarget(null)}>{tr("common.cancel")}</Button>
          <Button variant="contained" onClick={saveCredential} disabled={saving || !secretValue.trim()}>
            {saving ? tr("common.saving") : tr("integrations.saveSecurely")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* No-code OAuth application setup. The callback URL is generated and
          shown here so the customer never has to construct it or edit a file. */}
      <Dialog open={Boolean(oauthSetup)} onClose={() => setOauthSetup(null)} fullWidth maxWidth="sm">
        <DialogTitle>{tr("integrations.oauthSetupTitle", { name: oauthSetup?.displayName || "" })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {oauthSetup?.error && <Alert severity="error">{oauthSetup.error}</Alert>}
            <Alert severity="info">
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {tr("integrations.redirectUriInstruction")}
              </Typography>
              <Typography
                variant="body2"
                dir="ltr"
                sx={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.78rem", textAlign: "start" }}
              >
                {oauthSetup?.callbackUrl}
              </Typography>
            </Alert>
            {oauthSetup?.consoleUrl && (
              <Typography variant="caption" color="text.secondary">
                {tr("integrations.createAppAt")}{" "}
                <a href={oauthSetup.consoleUrl} target="_blank" rel="noreferrer" dir="ltr">
                  {oauthSetup.consoleUrl}
                </a>
                .
              </Typography>
            )}
            {(oauthSetup?.fields || []).map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                helperText={field.help}
                type={field.key === "clientSecret" ? "password" : "text"}
                value={oauthSetup?.values[field.key] || ""}
                onChange={(event) =>
                  setOauthSetup((prev) =>
                    prev ? { ...prev, values: { ...prev.values, [field.key]: event.target.value } } : prev,
                  )
                }
                fullWidth
              />
            ))}
            {(oauthSetup?.scopes || []).length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {tr("integrations.scopesTitle")}
                </Typography>
                <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                  {oauthSetup?.scopes.map((entry) => (
                    <Typography key={entry.scope} component="li" variant="caption" color="text.secondary">
                      {entry.reason}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOauthSetup(null)}>{tr("common.cancel")}</Button>
          <Button
            variant="contained"
            disabled={oauthSaving || !oauthSetup?.values.clientId || !oauthSetup?.values.clientSecret}
            onClick={saveOauthApp}
          >
            {oauthSaving ? tr("common.saving") : tr("common.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(disconnectTarget)}
        title={tr("integrations.disconnectConfirm", {
          name: disconnectTarget?.id ? catalogText(disconnectTarget.id, "label") : disconnectTarget?.name || "",
        })}
        description={tr("integrations.disconnectConfirmBody")}
        confirmLabel={tr("common.disconnect")}
        onClose={() => setDisconnectTarget(null)}
        onConfirm={disconnect}
      />
    </>
  );
};

const IntegrationsPage: React.FC = () => (
  <ErrorBoundary>
    <IntegrationsContent />
  </ErrorBoundary>
);

export default IntegrationsPage;
