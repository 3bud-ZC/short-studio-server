import React, { useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBackOutlined";
import CloudUploadIcon from "@mui/icons-material/CloudUploadOutlined";
import type { PublishingPlatform, SocialAccount } from "../../pages/v2Types";
import { useI18n } from "../../i18n";

/**
 * PUBLISHING CONNECTION
 * ---------------------
 * Each destination gets the form it actually needs. Where the engine has OAuth
 * we send the customer to it; where a service genuinely needs a token (Telegram
 * bots, Upload-Post) we ask for that and nothing else. All customer-visible
 * prose is resolved from the i18n catalogue.
 */

interface AccountConnectModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (account: SocialAccount) => void;
}

type FieldKey = "accountName" | "accountId" | "token";

type DestinationField = {
  key: FieldKey;
  labelKey: string;
  placeholder?: string;
  placeholderKey?: string;
  helperKey?: string;
  secret?: boolean;
  required: boolean;
};

type Destination = {
  id: string;
  /** Proper-noun name, or an i18n key when the label is descriptive. */
  label: string;
  labelKey?: string;
  blurbKey: string;
  icon: React.ReactNode;
  platform: PublishingPlatform;
  provider: string;
  connection: "token";
  fields: DestinationField[];
};

const DESTINATIONS: Destination[] = [
  {
    id: "upload_post",
    label: "Upload-Post",
    labelKey: "publishing.connect.dest.uploadPost.label",
    blurbKey: "publishing.connect.dest.uploadPost.blurb",
    icon: <CloudUploadIcon />,
    platform: "youtube",
    provider: "upload_post",
    connection: "token",
    fields: [
      {
        key: "accountName",
        labelKey: "publishing.connect.field.displayName",
        placeholderKey: "publishing.connect.field.displayNamePlaceholderUploadPost",
        required: true,
        helperKey: "publishing.connect.field.displayNameHelp",
      },
      {
        key: "token",
        labelKey: "publishing.connect.field.uploadPostKey",
        placeholderKey: "publishing.connect.field.uploadPostKeyPlaceholder",
        secret: true,
        required: true,
        helperKey: "publishing.connect.field.secretHelp",
      },
    ],
  },
];

export const AccountConnectModal: React.FC<AccountConnectModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const theme = useTheme();
  const t = theme.abud;
  const { t: tr } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    accountName: "",
    accountId: "",
    token: "",
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destination = useMemo(
    () => DESTINATIONS.find((entry) => entry.id === selectedId) || null,
    [selectedId],
  );

  const destinationLabel = (entry: Destination) => (entry.labelKey ? tr(entry.labelKey) : entry.label);

  const reset = () => {
    setSelectedId(null);
    setValues({ accountName: "", accountId: "", token: "" });
    setError(null);
    setTestResult(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  /** Validation depends on the destination, not on one shared rule. */
  const missingField = destination?.fields.find(
    (field) => field.required && !values[field.key].trim(),
  );

  const testConnection = async () => {
    if (!destination) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post(`/api/v2/providers/${destination.id}/validate`);
      const healthy = res.data?.healthy ?? res.data?.ok ?? false;
      setTestResult(
        healthy
          ? tr("publishing.connect.testSucceeded")
          : res.data?.message || tr("publishing.connect.testRejected"),
      );
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : tr("publishing.connect.unreachable");
      setTestResult(message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!destination || missingField) {
      setError(
        missingField ? tr("publishing.connect.required", { field: tr(missingField.labelKey) }) : null,
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("/api/v2/publishing/accounts", {
        platform: destination.platform,
        provider: destination.provider,
        accountName: values.accountName.trim(),
        // Upload-Post has no per-account handle; fall back to the display name.
        accountId: (values.accountId.trim() || values.accountName.trim()),
        token: values.token.trim() || undefined,
      });
      onSuccess(res.data.account);
      close();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : tr("publishing.connect.connectFailed");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>
        {destination
          ? tr("publishing.connect.titleFor", { destination: destinationLabel(destination) })
          : tr("publishing.connect.title")}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {!destination && (
            <>
              <Typography variant="body2" sx={{ color: t.textSecondary }}>
                {tr("publishing.connect.choose")}
              </Typography>
              <Grid container spacing={1.5}>
                {DESTINATIONS.map((entry) => (
                  <Grid item xs={12} sm={6} key={entry.id}>
                    <Card
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(entry.id)}
                      onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(entry.id);
                        }
                      }}
                      sx={{
                        p: 1.75,
                        height: "100%",
                        cursor: "pointer",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Box sx={{ color: t.primary, display: "flex" }}>{entry.icon}</Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={650}>
                            {destinationLabel(entry)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: t.textSecondary }}>
                            {tr(entry.blurbKey)}
                          </Typography>
                        </Box>
                      </Stack>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {destination?.connection === "token" && (
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: t.textSecondary }}>
                {tr(destination.blurbKey)}
              </Typography>
              {destination.fields.map((field) => (
                <TextField
                  key={field.key}
                  label={tr(field.labelKey)}
                  size="small"
                  fullWidth
                  required={field.required}
                  type={field.secret ? "password" : "text"}
                  placeholder={field.placeholderKey ? tr(field.placeholderKey) : field.placeholder}
                  helperText={field.helperKey ? tr(field.helperKey) : undefined}
                  value={values[field.key]}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              ))}
              {testResult && <Alert severity="info">{testResult}</Alert>}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {destination && (
          <Button startIcon={<ArrowBackIcon />} onClick={reset} disabled={loading}>
            {tr("common.back")}
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={close} disabled={loading}>
          {tr("common.cancel")}
        </Button>
        {destination?.connection === "token" && (
          <>
            <Button
              variant="outlined"
              onClick={testConnection}
              disabled={testing || Boolean(missingField)}
              startIcon={testing ? <CircularProgress size={16} /> : undefined}
            >
              {tr("common.testConnection")}
            </Button>
            <Button
              variant="contained"
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
              onClick={submit}
              disabled={loading || Boolean(missingField)}
            >
              {loading ? tr("publishing.connect.connecting") : tr("publishing.connect.connect")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};
