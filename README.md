# Short Studio

**Product:** Short Studio  
**Technical Product:** Short Studio Server  
**Version:** 2.5.0 (General Availability Candidate; formerly ABUD Shorts Engine 2.4.0; full history is tracked in `ABUD_SHORTS_ENGINE_STATUS.md`)  
**Canonical Dashboard:** http://localhost:3130  
**License:** MIT  

An enterprise-grade, local-first short video generation, multi-platform publishing, and social distribution engine built for TikTok, YouTube Shorts, Instagram Reels, Facebook Reels, and Telegram.

---

## Table of Contents

1. [Overview & Capabilities](#overview--capabilities)
2. [System Requirements](#system-requirements)
3. [Quick Start (One-Command Installer)](#quick-start-one-command-installer)
4. [First-Run Setup Wizard](#first-run-setup-wizard)
5. [Free / Local Pipeline Mode](#free--local-pipeline-mode)
6. [Optional Cloud AI Providers](#optional-cloud-ai-providers)
7. [Publishing & Social Distribution](#publishing--social-distribution)
8. [Admin Security & Credentials](#admin-security--credentials)
9. [Backup & Disaster Recovery](#backup--disaster-recovery)
10. [Maintenance, Upgrades & Uninstall](#maintenance-upgrades--uninstall)
11. [Diagnostics & Telemetry](#diagnostics--telemetry)
12. [Remote & VPS Deployment](#remote--vps-deployment)
13. [Troubleshooting](#troubleshooting)
14. [License & Credits](#license--credits)

---

## Overview & Capabilities

Short Studio transforms text ideas and brand assets into high-engagement vertical short videos with synchronized captions, motion transitions, background music, and direct social distribution.

- **Dual Creation Modes**:
  - **Prompt Studio**: AI-powered scriptwriting in Egyptian Arabic, Gulf Arabic, Modern Standard Arabic (MSA), and English with automatic scene segmentation.
  - **Template Studio**: 6 pre-built business templates (Product Ad, Restaurant Promo, Real Estate Showcase, Viral Hook, Educational Explainer, Event Promo) with custom brand injection.
- **Production Spec Engine**: Exact duration guarantees, multi-scene timeline assembly, animated text overlays, ArabicCaptionEngine V2 RTL typography, and motion presets.
- **Free/Local English Core**: Generate high-definition vertical videos using local AI planning, Pexels media, Kokoro English TTS, Whisper small captions, Remotion, FFmpeg, and Audio Mastering.
- **Local Egyptian Arabic Voice**: Arabic narration defaults to the built-in Local Voice engine - VoiceTut (Local High Quality, GPU-accelerated, human-reviewed and approved) with a lightweight local fallback - no provider key, no cloud call, no per-video cost. ElevenLabs (`eleven_multilingual_v2`) is available as an optional premium alternative a customer may configure and select explicitly in **Providers -> ElevenLabs**.
- **Revision Studio**: Create voice, media, and caption-style revisions with durable artifact reuse so cheap edits avoid unnecessary voice/caption regeneration where possible.
- **Publishing & Scheduling Automation**: Unified scheduling, atomic publication state machine, retry policies, dead-letter isolation, and live SSE event streams.
- **Security & Reliability**: Salted password authentication, zero secret leakage, role-based Docker isolation, automated pre-upgrade safety snapshots, and one-click diagnostic bundles.

---

## System Requirements

| Requirement | Specification |
| --- | --- |
| **Operating System** | Windows 10/11 (with WSL2 & Docker Desktop), macOS 12+, or Linux (Ubuntu 20.04+, Debian 11+, RHEL 9+) |
| **Container Engine** | Docker Engine 24.0+ and Docker Compose v2.20+ |
| **CPU** | 2 vCPUs minimum (4+ vCPUs recommended for faster rendering) |
| **RAM** | 4 GB minimum (8 GB recommended) |
| **Disk Space** | 5 GB free disk space for containers, models, and cache |
| **Network** | Internet access required for initial media downloads (Pexels) and optional cloud APIs |

---

## Quick Start (One-Command Installer)

### Windows (PowerShell)

Open PowerShell as Administrator or standard user and run:

```powershell
.\install.ps1
```

*Custom HTTP Port option:* `.\install.ps1 -Port 3131`

### Linux / macOS (Bash)

```bash
chmod +x install.sh
./install.sh
```

*Custom HTTP Port option:* `./install.sh 3131`

The installer performs all initialization steps automatically:
1. Validates Docker daemon and available disk space.
2. Checks port availability (3130).
3. Creates persistent host storage directories (`data/videos`, `data/cache`, `data/backups`, `data/logs`).
4. Generates cryptographically secure secrets in `.env` (`INTERNAL_SERVICE_TOKEN`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `SESSION_SECRET`, `PROVIDER_VAULT_MASTER_KEY`).
5. Builds and launches the 4-tier Docker stack (`short-studio-app`, `short-studio-render-worker`, `short-studio-n8n`, `short-studio-postgres`).
6. Executes database schema migrations.
7. Verifies health probes and presents the ready dashboard.

---

## First-Run Setup Wizard

Once installed, navigate in your web browser to:

```text
http://localhost:3130/setup
```

The interactive 10-step wizard configures:
1. **System Health Verification**: Docker runtime, PostgreSQL connectivity, and storage mounts.
2. **Admin Credentials**: Create your initial administrator account with secure password hashing.
3. **Pexels Stock Footage**: Enter your free [Pexels API Key](https://www.pexels.com/api/) for high-quality stock video retrieval.
4. **Optional Cloud AI Keys**: Connect Google Gemini, ElevenLabs, or Veo if desired.
5. **Publishing Integrations**: Configure Telegram bot tokens or Upload-Post API keys.
6. **Default Production Settings**: Select default language (`ar` / `en`), Arabic dialect (`egyptian`, `gulf`, `msa`), and default brand profile.

---

## Free / Local Pipeline Mode

Short Studio is engineered so that you do **not** need paid third-party AI subscriptions to produce complete, professional videos:

| Pipeline Stage | Free / Local Component | Function |
| --- | --- | --- |
| **Creative Direction** | Local Rule-Based Creative Director | Generates complete scene blueprints, hooks, visual search queries, and narration lines deterministically. |
| **Visual Assets** | Pexels API Integration | Fetches HD vertical background videos based on semantic tags and scene themes. |
| **Arabic Voice Synthesis** | VoiceTut - Local High Quality | Local, GPU-accelerated Egyptian Arabic narration, human-reviewed and approved, no per-video cost. KemeTone provides a lightweight local fallback. Auto-installed and hardware-detected by the Windows installer. |
| **Premium Arabic Voice (optional)** | ElevenLabs (`eleven_multilingual_v2`) | Cloud, usage-based premium alternative a customer may configure and select explicitly in Providers -> ElevenLabs -> Voice Lab. Never a silent default. |
| **Legacy Arabic Voice** | Piper (`ar_JO-kareem-medium`) | Retained for historical jobs only so existing videos and metadata stay readable. Not installed in the current image and never used for new production. |
| **English Voice Synthesis** | Kokoro TTS (`q4` precision) | Local English narration path inside the worker container. |
| **Captions & Subtitles** | Whisper.cpp (`small`, multilingual) | Generates subtitle timings with custom font styling and RTL Arabic formatting. |
| **Composition & Render** | Remotion + FFmpeg 4.4 | Assembles video scenes, transitions, balanced music ducking, Audio Mastering, and final MP4 encoding. |

---

## Optional Cloud AI Providers

For enhanced generative workflows, optional cloud providers can be activated in **Providers & AI Engine** (`/providers`):

- **Google Gemini** (`GEMINI_API_KEY`): Advanced multi-scene creative direction, viral script brainstorming, and dynamic Arabic copywriting.
- **Google Cloud TTS** (`GOOGLE_APPLICATION_CREDENTIALS` or ADC): Optional server-side Arabic cloud TTS provider.
- **ElevenLabs** (`ELEVENLABS_API_KEY`): Optional premium multilingual neural speech provider.
- **Google Veo & fal.ai Kling/Wan** (`FAL_KEY`): AI text-to-video clip generation for scenes requiring synthetic visuals.

---

## Publishing & Social Distribution

Manage accounts, schedule releases, and publish to multiple platforms simultaneously:

- **Aggregated Publishing (Upload-Post)**: One-click simultaneous publishing to YouTube Shorts, Instagram Reels, TikTok, Facebook, LinkedIn, X (Twitter), and Threads.
- **Telegram Direct Bot**: Instant distribution to Telegram public channels or group chats with custom caption formatting.
- **Direct Platform APIs**: YouTube Data API v3, Meta Graph API (Instagram/Facebook), and TikTok OpenAPI connectors.
- **Smart Queue & Scheduling**: Automated background publisher checks schedule slots every 30 seconds, enforces concurrency limits, and handles transient rate-limiting (HTTP 429) with exponential backoff.

---

## Admin Security & Credentials

- **Local Authentication**: Salted PBKDF2 (100,000 iterations) with SHA-512 password derivation and secure cookie sessions.
- **Network Isolation**: PostgreSQL, n8n orchestrator, and render worker are bound to internal Docker bridge network only; only the web app port (`3130`) is exposed.
- **Zero Secret Leakage**: API keys and database credentials are fully masked/redacted in browser UI, diagnostic bundles, and system logs.
- **Security Headers**: Standard browser hardening headers enabled, including Content Security Policy, X-Frame-Options, X-Content-Type-Options, and Referrer-Policy.
Fresh installations use the Setup Wizard to create an initial admin account. The prepared local handoff installation has admin username `1234` configured; the password is delivered through the private handoff channel, not public documentation.

---

## Backup & Disaster Recovery

Create and restore system state from the **System** dashboard (`/system`) or REST API:

- **Backup Types**:
  - `config_only`: App settings, brand profiles, and provider configurations.
  - `config_db`: Full PostgreSQL database dump + configurations.
  - `full`: Complete database snapshot, configurations, and generated video storage archive.
- **Integrity**: Every backup is packaged with a SHA256 checksum manifest.
- **Pre-Restore Safety Snapshot**: An automated safety backup is created prior to restoring an existing snapshot.

---

## Maintenance, Upgrades & Uninstall

### Upgrading to New Releases

Run the upgrade script in the project root:

**Windows (PowerShell):**
```powershell
.\upgrade.ps1
```

**Linux / macOS (Bash):**
```bash
./upgrade.sh
```

The upgrade script automatically:
1. Creates a pre-upgrade safety backup.
2. Rebuilds the updated Docker images.
3. Applies database schema migrations.
4. Verifies service health after startup.

### Uninstallation

**Preserve Generated Videos & Database (Default):**
```powershell
.\uninstall.ps1
```
```bash
./uninstall.sh
```

**Complete Clean Removal (Destructive):**
```powershell
.\uninstall.ps1 -RemoveData
```
```bash
./uninstall.sh --remove-data
```

---

## Diagnostics & Telemetry

Access system diagnostics at `http://localhost:3130/system`:
- **Real-Time Service Probes**: PostgreSQL latency, internal n8n status, render-worker responsiveness.
- **Storage Breakdown**: Real-time byte accounting across `videos/`, `cache/`, `backups/`, and `logs/`.
- **Sanitized Logs**: View recent system events with all passwords, tokens, and OAuth keys automatically redacted.
- **One-Click Diagnostic Bundle**: Export `short_studio_diagnostics_<timestamp>.json` for technical support and troubleshooting.

---

## Remote & VPS Deployment

For remote hosting on a VPS or cloud server:
1. Ensure ports `80` and `443` are open on your server firewall.
2. Configure a reverse proxy using the provided template:
   ```text
   nginx.conf.reference
   ```
3. Set your custom domain in `V2_PUBLIC_URL` inside `.env`.
4. The Nginx configuration includes pre-configured WebSocket support for HMR/SSE, client payload limits for video uploads (50MB), and byte-range streaming for MP4 previews.

---

## Troubleshooting

### 1. Docker daemon not running
- **Symptom:** Installer reports `Docker daemon is not running`.
- **Solution:** Launch Docker Desktop on Windows/macOS or start the docker service on Linux (`sudo systemctl start docker`).

### 2. Pexels API Key invalid or rate-limited
- **Symptom:** Video job fails during the visual asset collection stage.
- **Solution:** Verify your API key at `http://localhost:3130/providers`. Obtain a free key at [pexels.com/api](https://www.pexels.com/api/).

### 3. Port 3130 already occupied
- **Symptom:** Port conflict error during installation.
- **Solution:** Re-run the installer with a custom port: `.\install.ps1 -Port 3135` (or `./install.sh 3135`).

### 4. Container logs inspection
- View live application logs:
  ```bash
  short-studio logs app
  ```
- View render worker logs:
  ```bash
  short-studio logs worker
  ```
  (An installation upgraded from ABUD Shorts Engine 2.4 can still fall back to
  `docker logs --tail=100 -f abud-shorts-app` / `abud-shorts-render-worker`.)

---

## License & Credits

Short Studio is licensed under the [MIT License](LICENSE).

### Open-Source Acknowledgments
- [Remotion](https://remotion.dev) — Programmatic video rendering in React.
- [Kokoro TTS](https://github.com/hexgrad/kokoro) — Fast local neural speech synthesis.
- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) — High-efficiency speech transcription.
- [Pexels](https://www.pexels.com) — Curated stock video library.
- [FFmpeg](https://ffmpeg.org) — Audio and video multiplexing and transcoding.
- [n8n](https://n8n.io) — Workflow automation and internal orchestration.
