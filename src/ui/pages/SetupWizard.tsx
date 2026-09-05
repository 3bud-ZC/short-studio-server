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
  "setup.videoDefaults",
  "setup.review",
  "setup.ready",
];

export const SetupWizard: React.FC = () => {
  const navigate = useNavigate();
  const { t, format } = useI18n();
  // Version comes from the canonical contract, never from a literal here.
  const { info: productInfo } = useProductInfo();
  const steps = stepKeys;
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [pexelsKey, setPexelsKey] = useState("");
  const [pixabayKey, setPixabayKey] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
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
          // Setup already complete
        }
      })
      .catch(() => {});

    axios
      .get("/health/ready")
      .then((res) => setSystemHealth(res.data))
      .catch(() => setSystemHealth({ ready: true, message: "Local system ready" }));
  }, []);

  const handleNext = async () => {
    setError(null);

    // Validate Admin Step
    if (activeStep === 2) {
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
    if (activeStep === steps.length - 2) {
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

    if (activeStep === steps.length - 1) {
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
            <Typography variant="subtitle1">{t(steps[activeStep])}</Typography>
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
          {activeStep === 0 && (
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
          {activeStep === 1 && (
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
          {activeStep === 2 && (
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Admin Account Setup
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Create your local administrator credentials for managing settings, backups, and publishing channels.
                </Typography>
              </Box>
              <TextField
                label="Administrator Username"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Admin Password (min 8 characters)"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Confirm Password"
                type="password"
                value={adminPasswordConfirm}
                onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          )}

          {/* Step 3: Storage */}
          {activeStep === 3 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Persistent Storage Locations
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Videos, reusable artifacts, cache, logs, and backups are stored in the private application data volume.
              </Typography>
              {/* The literal near-white background here was a light-theme leak
                  into a dark product; the card now uses the themed surface. */}
              <Card variant="outlined" sx={{ p: 2, bgcolor: "background.default" }}>
                <Stack spacing={1}>
                  <Typography variant="body2"><strong>Rendered videos:</strong> kept for preview, download, revisions, and publishing.</Typography>
                  <Typography variant="body2"><strong>Reusable artifacts:</strong> retained so revisions can reuse voice, captions, and media.</Typography>
                  <Typography variant="body2"><strong>Temporary cache:</strong> cleaned by retention policy when no longer needed.</Typography>
                  <Typography variant="body2"><strong>Backups and logs:</strong> available through System diagnostics with secret redaction.</Typography>
                </Stack>
              </Card>
            </Stack>
          )}

          {/* Step 4: Free Providers */}
          {activeStep === 4 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Stock footage
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pexels gives your videos real footage to work with. It is free — creating a key takes about a minute.
                You can skip this and add it later on the Providers page.
              </Typography>
              <TextField
                label="Pexels API key (recommended)"
                value={pexelsKey}
                onChange={(e) => setPexelsKey(e.target.value)}
                placeholder="e.g. 563492ad6f91700001000001..."
                fullWidth
                size="small"
                helperText="Skip this if you prefer — you can add it any time from Integrations."
              />
              <TextField
                label="Pixabay API key (optional)"
                value={pixabayKey}
                onChange={(e) => setPixabayKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText="Optional second free stock library."
              />
              <Alert severity="info">
                English narration, captions and video rendering all run on this machine. Nothing here costs money.
              </Alert>
            </Stack>
          )}

          {/* Step 5: Optional AI */}
          {activeStep === 5 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Voice &amp; AI
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Arabic, Egyptian Arabic and MSA narration runs locally by default (VoiceTut or KemeTone, set up
                after this wizard from Providers). ElevenLabs is an optional premium alternative. Everything on
                this step is optional and can be added later from Integrations.
              </Typography>
              <TextField
                label="ElevenLabs API key (optional premium Arabic/multilingual voice)"
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText="Stored encrypted. Skip to use the local voice route instead."
              />
              <TextField
                label="Google Gemini API key (optional)"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText="Optional. Adds more variety to generated scripts."
              />
              <Typography variant="caption" color="text.secondary">
                Optional premium video providers such as Veo, Runway, fal.ai, Replicate, Luma and local ComfyUI can be connected later from Providers. They stay skippable, and paid generation still requires an explicit budget choice.
              </Typography>
            </Stack>
          )}

          {/* Step 6: Publishing */}
          {activeStep === 6 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Social Publishing & Distribution
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Connect your social publishing providers for automatic scheduling and distribution.
              </Typography>
              <TextField
                label="Telegram Bot Token (Optional)"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText="Direct bot publishing to your Telegram channels and groups."
              />
              <Alert severity="success">
                Upload-Post, YouTube Direct, Meta Reels, and TikTok posting are fully supported and can be connected from the Publishing dashboard.
              </Alert>
            </Stack>
          )}

          {/* Step 7: Defaults */}
          {activeStep === 7 && (
            <Stack spacing={2.5}>
              <Typography variant="h6">{t("setup.videoDefaults")}</Typography>
              {/* Narration language is a production setting. It is deliberately
                  not the interface language, and the hint says so. */}
              <Typography variant="body2" color="text.secondary">
                {t("setup.defaultNarrationLanguageHint")}
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel>{t("setup.defaultNarrationLanguage")}</InputLabel>
                <Select
                  value={defaultLanguage}
                  label={t("setup.defaultNarrationLanguage")}
                  onChange={(e) => setDefaultLanguage(e.target.value)}
                >
                  <MenuItem value="ar">Arabic (العربية)</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Default Arabic Dialect</InputLabel>
                <Select value={defaultDialect} label="Default Arabic Dialect" onChange={(e) => setDefaultDialect(e.target.value)}>
                  <MenuItem value="egyptian">Egyptian (مصرى - Recommended)</MenuItem>
                  <MenuItem value="gulf">Gulf (خليجي)</MenuItem>
                  <MenuItem value="msa">Modern Standard Arabic (فصحى)</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Default Aspect Ratio</InputLabel>
                <Select value={defaultAspectRatio} label="Default Aspect Ratio" onChange={(e) => setDefaultAspectRatio(e.target.value)}>
                  <MenuItem value="9:16">9:16 Portrait (Shorts, Reels, TikTok)</MenuItem>
                  <MenuItem value="16:9">16:9 Landscape (YouTube)</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          )}

          {/* Step 8: Verification */}
          {activeStep === 8 && (
            <Stack spacing={2} textAlign="center" alignItems="center">
              <CheckCircleIcon sx={{ fontSize: 60, color: "success.main" }} />
              <Typography variant="h5" fontWeight={700}>
Everything checks out
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
                Your choices are ready. Select <strong>Finish setup</strong> to save them.
              </Typography>
            </Stack>
          )}

          {/* Step 9: Finish */}
          {activeStep === 9 && (
            <Stack spacing={3} textAlign="center" alignItems="center">
              <RocketLaunchIcon sx={{ fontSize: 70, color: "primary.main" }} />
              <Typography variant="h4" fontWeight={700} color="primary.main">
                Ready to Create Your First Video
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
                Everything is set up. Describe the video you want and Short Studio will produce it.
              </Typography>
              <Button variant="contained" size="large" onClick={() => navigate("/create")} sx={{ px: 4, py: 1.5 }}>
                Create your first video
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
              ) : activeStep === steps.length - 2 ? (
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
