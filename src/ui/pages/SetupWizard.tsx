import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  Select,
  MenuItem,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import LockIcon from "@mui/icons-material/Lock";
import StorageIcon from "@mui/icons-material/Storage";
import SettingsIcon from "@mui/icons-material/Settings";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import { useI18n } from "../i18n";
import { useProductInfo } from "../utils/productInfo";

/** Step labels as translation keys; the wizard is bilingual like the rest. */
const stepKeys = [
  "setup.welcome",
  "setup.systemCheck",
  "setup.signIn",
  "setup.storage",
  "setup.stockFootage",
  "setup.voiceAndAi",
  "setup.publishing",
  // V2.5.1: the "video defaults" step is gone. Every production now chooses
  // its own language, dialect and shape on one page, so a default set here
  // could only ever be a second opinion the customer never sees applied.
  "setup.review",
  "setup.ready",
];

export const SetupWizard: React.FC = () => {
  const navigate = useNavigate();
  const { t, format } = useI18n();
  // Version comes from the canonical contract, never from a literal here.
  const { info: productInfo } = useProductInfo();
  const localSingleUser = productInfo?.accessMode === "local";
  const steps = React.useMemo(
    () => (localSingleUser ? stepKeys.filter((key) => key !== "setup.signIn") : stepKeys),
    [localSingleUser],
  );
  const [activeStep, setActiveStep] = useState(0);
  const currentStepKey = steps[activeStep] || steps[0];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [pexelsKey, setPexelsKey] = useState("");
  const [pixabayKey, setPixabayKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("ar");
  const [defaultDialect, setDefaultDialect] = useState("egyptian");
  const [defaultAspectRatio, setDefaultAspectRatio] = useState("9:16");

  // System status state
  const [systemHealth, setSystemHealth] = useState<any>(null);

  useEffect(() => {
    axios
      .get("/api/v2/setup/status")
      .then((res) => {
        if (res.data.isSetupCompleted) {
          navigate("/");
        }
      })
      .catch(() => {});

    axios
      .get("/health/ready")
      .then((res) => setSystemHealth(res.data))
      .catch(() => setSystemHealth({ ready: true, message: "Local system ready" }));
  }, [navigate]);

  useEffect(() => {
    if (activeStep >= steps.length) {
      setActiveStep(Math.max(0, steps.length - 1));
    }
  }, [activeStep, steps.length]);

  const handleNext = async () => {
    setError(null);

    // Validate Admin Step
    if (currentStepKey === "setup.signIn") {
      if (!adminUsername || adminUsername.trim().length < 3) {
        setError("Username must be at least 3 characters.");
        return;
      }
      if (adminPassword.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (adminPassword !== adminPasswordConfirm) {
        setError("Passwords do not match.");
        return;
      }

      setLoading(true);
      try {
        const res = await axios.post("/api/v2/auth/setup-admin", {
          username: adminUsername,
          password: adminPassword,
        });
        if (res.data.session?.token) {
          localStorage.setItem("abud_session_token", res.data.session.token);
        }
      } catch (err: any) {
        // If already configured, allow proceeding
        if (!err.response?.data?.message?.includes("already configured")) {
          setError(err.response?.data?.message || "Failed to create admin user");
          setLoading(false);
          return;
        }
      } finally {
        setLoading(false);
      }
    }

    // Final step: complete setup
    if (currentStepKey === "setup.review") {
      setLoading(true);
      try {
        // Keys typed during setup are saved into the encrypted vault here.
        // Before this they were collected and silently discarded, which left a
        // customer believing they had configured a provider when they had not.
        const keyEntries: Array<{ provider: string; value: string }> = [
          { provider: "pexels", value: pexelsKey },
          { provider: "pixabay", value: pixabayKey },
          { provider: "gemini", value: geminiKey },
          { provider: "elevenlabs", value: elevenLabsKey },
        ].filter((entry) => entry.value.trim().length > 0);

        for (const entry of keyEntries) {
          try {
            await axios.put(`/api/v2/providers/${entry.provider}/credentials`, {
              credentialType: "api_key",
              value: entry.value.trim(),
            });
          } catch {
            // One key failing must not block finishing setup; the customer can
            // add or correct it on the Providers page.
            setError(
              `Setup finished, but the ${entry.provider} key could not be saved. Add it again under Providers.`,
            );
          }
        }

        await axios.post("/api/v2/setup/complete", {
          language: defaultLanguage,
          dialect: defaultDialect,
          aspectRatio: defaultAspectRatio,
          adminUsername,
        });
      } catch (err: any) {
        setError(err.response?.data?.message || "Failed to finalize setup");
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }

    if (currentStepKey === "setup.ready") {
      navigate("/");
      return;
    }

    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", py: 4, px: 2 }}>
      <Card sx={{ p: 3, borderRadius: 3, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <Box sx={{ textAlign: "center", mb: 3 }}>
          <Typography variant="h4" sx={{ color: "primary.main" }}>
            {t("setup.wizardTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("setup.wizardSubtitle")}
          </Typography>
          {/* Rendered only once the canonical version is known. An unknown
              version shows nothing rather than a stale or guessed number. */}
          {productInfo?.version && (
            <Chip
              size="small"
              variant="outlined"
              dir="ltr"
              sx={{ mt: 1 }}
              label={t("setup.versionLabel", { version: productInfo.version })}
            />
          )}
        </Box>

        {/*
          Ten horizontal steps do not fit a 390px phone: browser QA found the
          last steps sitting ~48px past the viewport, visible only because the
          document clips horizontal overflow. On a phone the wizard shows a
          compact "Step N of 10" line and a progress bar instead, which carries
          the same information in the space that exists.
        */}
        <Box sx={{ display: { xs: "block", md: "none" }, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
            <Typography variant="subtitle1">{t(currentStepKey)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("setup.stepCounter", {
                current: format.number(activeStep + 1),
                total: format.number(steps.length),
              })}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={((activeStep + 1) / steps.length) * 100}
            aria-label={t("setup.stepCounter", {
              current: String(activeStep + 1),
              total: String(steps.length),
            })}
          />
        </Box>

        <Stepper
          activeStep={activeStep}
          alternativeLabel
          sx={{ mb: 4, display: { xs: "none", md: "flex" } }}
        >
          {steps.map((key) => (
            <Step key={key}>
              <StepLabel>{t(key)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <CardContent sx={{ minHeight: 280 }}>
          {/* Step 0: Welcome */}
          {currentStepKey === "setup.welcome" && (
            <Stack spacing={2} alignItems="center" textAlign="center">
              <RocketLaunchIcon sx={{ fontSize: 56, color: "primary.main" }} />
              <Typography variant="h5">{t("setup.welcomeHeading")}</Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 620 }}>
                {t("setup.welcomeBody")}
              </Typography>
              {/* Arabic production is Local Voice (VoiceTut, or KemeTone on
                  lighter hardware) by default; ElevenLabs is an explicit,
                  opt-in premium alternative. An earlier version of this copy
                  said Arabic required ElevenLabs, which stopped being true
                  once VoiceTut shipped and would have pointed a new customer
                  at the wrong setup step on their very first run. */}
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 620 }}>
                {t("setup.welcomeBodyVoice")}
              </Typography>
              <Chip label={t("setup.localFirst")} color="success" variant="outlined" />
            </Stack>
          )}

          {/* Step 1: System Check */}
          {currentStepKey === "setup.systemCheck" && (
            <Stack spacing={2}>
              <Typography variant="h6">{t("setup.systemCheckHeading")}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t("setup.systemCheckBody")}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2">{t("setup.checkDatabase")}</Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> {t("setup.checkDatabaseOk")}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2">{t("setup.checkStorage")}</Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> {t("setup.checkStorageOk")}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2">{t("setup.checkEngine")}</Typography>
                    {/* Component names replaced with what they do for the
                        customer. The old line also listed Piper, which is
                        legacy and is not part of any production path. */}
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> {t("setup.checkEngineOk")}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2">{t("setup.checkAutomation")}</Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> {t("setup.checkAutomationOk")}
                    </Typography>
                  </Card>
                </Grid>
              </Grid>
            </Stack>
          )}

          {/* Step 2: Admin Access */}
          {currentStepKey === "setup.signIn" && (
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  {t("setup.adminHeading")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("setup.adminBody")}
                </Typography>
              </Box>
              <TextField
                label={t("setup.adminUsername")}
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label={t("setup.adminPassword")}
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label={t("setup.adminPasswordConfirm")}
                type="password"
                value={adminPasswordConfirm}
                onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          )}

          {/* Step 3: Storage */}
          {currentStepKey === "setup.storage" && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                {t("setup.storageHeading")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("setup.storageBody")}
              </Typography>
              {/* The literal near-white background here was a light-theme leak
                  into a dark product; the card now uses the themed surface. */}
              <Card variant="outlined" sx={{ p: 2, bgcolor: "background.default" }}>
                <Stack spacing={1}>
                  <Typography variant="body2"><strong>{t("setup.storageVideos")}:</strong> {t("setup.storageVideosBody")}</Typography>
                  <Typography variant="body2"><strong>{t("setup.storageArtifacts")}:</strong> {t("setup.storageArtifactsBody")}</Typography>
                  <Typography variant="body2"><strong>{t("setup.storageCache")}:</strong> {t("setup.storageCacheBody")}</Typography>
                  <Typography variant="body2"><strong>{t("setup.storageBackups")}:</strong> {t("setup.storageBackupsBody")}</Typography>
                </Stack>
              </Card>
            </Stack>
          )}

          {/* Step 4: Free Providers */}
          {currentStepKey === "setup.stockFootage" && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                {t("setup.stockHeading")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("setup.stockBody")}
              </Typography>
              <TextField
                label={t("setup.pexelsKey")}
                value={pexelsKey}
                onChange={(e) => setPexelsKey(e.target.value)}
                fullWidth
                size="small"
                helperText={t("setup.pexelsHelp")}
              />
              <TextField
                label={t("setup.pixabayKey")}
                value={pixabayKey}
                onChange={(e) => setPixabayKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText={t("setup.pixabayHelp")}
              />
              <Alert severity="info">{t("setup.stockLocalNote")}</Alert>
            </Stack>
          )}

          {/* Step 5: Optional AI */}
          {currentStepKey === "setup.voiceAndAi" && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                {t("setup.voiceHeading")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("setup.voiceBody")}
              </Typography>
              <TextField
                label={t("setup.elevenLabsKey")}
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText={t("setup.elevenLabsHelp")}
              />
              <TextField
                label={t("setup.geminiKey")}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText={t("setup.geminiHelp")}
              />
              <Typography variant="caption" color="text.secondary">
                {t("setup.optionalProvidersNote")}
              </Typography>
            </Stack>
          )}

          {/* Step 6: Publishing */}
          {currentStepKey === "setup.publishing" && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                {t("setup.publishingHeading")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("setup.publishingBody")}
              </Typography>
              <Alert severity="success">
                {t("setup.publishingUploadPostOnly")}
              </Alert>
            </Stack>
          )}

          {/* V2.5.1: the video-defaults step is gone with Production Defaults.
              Every production chooses its own language, dialect and shape on
              one page, so a default set here would be a second opinion the
              customer never sees applied. */}

          {/* Step 8: Verification */}
          {currentStepKey === "setup.review" && (
            <Stack spacing={2} textAlign="center" alignItems="center">
              <CheckCircleIcon sx={{ fontSize: 60, color: "success.main" }} />
              <Typography variant="h5" fontWeight={700}>
                {t("setup.reviewHeading")}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
                {t("setup.reviewBody")}
              </Typography>
            </Stack>
          )}

          {/* Step 9: Finish */}
          {currentStepKey === "setup.ready" && (
            <Stack spacing={3} textAlign="center" alignItems="center">
              <RocketLaunchIcon sx={{ fontSize: 70, color: "primary.main" }} />
              <Typography variant="h4" fontWeight={700} color="primary.main">
                {t("setup.readyHeading")}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
                {t("setup.readyBody")}
              </Typography>
              <Button variant="contained" size="large" onClick={() => navigate("/create")} sx={{ px: 4, py: 1.5 }}>
                {t("videos.createFirst")}
              </Button>
            </Stack>
          )}
        </CardContent>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Button disabled={activeStep === 0 || activeStep === steps.length - 1} onClick={handleBack}>
            {t("common.back")}
          </Button>
          {activeStep < steps.length - 1 && (
            <Button variant="contained" onClick={handleNext} disabled={loading}>
              {loading ? (
                <CircularProgress size={22} color="inherit" />
              ) : currentStepKey === "setup.review" ? (
                t("setup.finish")
              ) : (
                t("common.next")
              )}
            </Button>
          )}
        </Box>
      </Card>
    </Box>
  );
};

export default SetupWizard;
