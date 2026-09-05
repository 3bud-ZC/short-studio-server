# Short Studio 2.5.0

**Product:** Short Studio
**Technical Product:** Short Studio Server
**Release Version:** `2.5.0`
**Release Channel:** stable (candidate)
**Stage:** General Availability Candidate
**Database Schema:** `2.13.0` (unchanged from v2.4.0 - branding release, no schema migration required)
**Previous Product:** ABUD Shorts Engine `2.4.0`

Short Studio is the renamed, commercially productized continuation of ABUD
Shorts Engine. This release carries no functional change to video production,
captions, or providers beyond the 2.4.0 baseline documented below - it
establishes the Short Studio product identity, CLI, container/volume naming,
and installer/updater flow, with an explicit compatibility path so an
installation upgraded from ABUD Shorts Engine 2.4.0 keeps its existing
database, videos, Provider Vault, backups, and n8n data without
re-provisioning. `abud-shorts` remains available as a legacy CLI alias for
upgraded installations.

---

# ABUD Shorts Engine v2.4.0

**Product:** ABUD Shorts Engine
**Release Version:** `2.4.0`
**Release Channel:** stable
**Database Schema:** `2.13.0` (unchanged from v2.3.1 - no migration required)
**Previous Stable:** `2.3.1`

This is the public General Availability release of V2.4.

---

## What's New

### Professional Video Engine

- Auto Professional now prioritizes real, relevant stock footage for normal
  business and educational shorts.
- The fast FFmpeg render path is used when a stock-heavy production qualifies,
  with Motion rendering kept for intentional graphic and animated explainer
  videos.
- Final-media QA checks coverage, black frames, text-only fallback, duration,
  audio continuity, captions and professional readiness before a video is
  accepted. A visual provider that fails or returns nothing usable now always
  fails closed with a clear, actionable message instead of an internal error.

### Smarter Creative Planning

- Prompt Compiler turns user prompts into safer production specs with clearer
  facts, scene intent and customer-friendly decisions.
- Content safety keeps claims grounded and prevents invented contact channels.
- CTA handling preserves provenance, so customer-supplied contact details stay
  explicit and generated videos do not invent phone numbers, websites or social
  handles.

### Local Egyptian Arabic Voice

- **VoiceTut (Local High Quality)** is the default Arabic production voice: a
  local, GPU-accelerated Egyptian Arabic engine with 17 built-in speakers,
  code-switching support, and no per-video cost. Human-reviewed and approved,
  including a full Egyptian sample, an Arabic-English code-switch sample, and
  a complete golden production.
- **KemeTone (Local Lightweight)** provides a CPU fallback for machines
  without a compatible GPU.
- **ElevenLabs** remains available as an optional premium cloud alternative -
  a customer may configure and select it explicitly - but it is never a
  silent default and never required for Arabic production.
- **Windows installation is now fully automated.** The installer detects
  hardware (NVIDIA GPU, VRAM, disk), recommends the best supported Local
  Voice mode automatically, installs a product-owned Python runtime and the
  pinned model weights, and starts the local voice service - no manual
  script, no developer terminal. The model cache and runtime persist across
  updates.
- Windows auto-start is product-managed: a per-user scheduled task by
  default, with an automatic Startup-folder fallback on machines where Task
  Scheduler denies task creation for that account - neither path requires
  administrator rights or a stored password.

### Providers and Voice

- Free Only, Smart Budget and Best Available routing make provider selection
  more predictable.
- Paid video providers are gated: credentials alone do not authorize a paid
  generation.
- Kokoro remains the local/free English voice path.
- The Provider Vault stores configured provider credentials encrypted and shows
  only safe status and masked hints in the interface.

### Publishing

- Publishing now has a clearer provider lifecycle: implemented, configured,
  authenticated, healthy and live verified are reported separately.
- Manual publishing credentials are encrypted.
- OAuth setup shows browser-friendly callback URLs.
- Upload-Post, YouTube processing states, retry, idempotency, scheduler
  persistence, partial failure handling and safe Server-Sent Events have all
  been hardened.

### Owner Account & Recovery

- A full local owner-account lifecycle: change username/password (revokes
  every other session on success), session listing and revocation, and a
  local-only recovery command (`abud-shorts owner reset-password`) for a lost
  username or password - no email, token or predictable secret involved.

### Security and Operations

- Protected APIs require admin session or scoped API token access.
- Video preview/download routes support authenticated browser playback and byte
  ranges.
- Diagnostics, provider responses and logs are designed to avoid plaintext
  secrets, session tokens and raw OAuth values.
- Updates continue to use the host updater: checksum verification, digest-
  pinned image pull, pre-update backup, health checks and rollback - verified
  in this release through a real isolated v2.3.1 -> 2.4.0 upgrade rehearsal,
  including a real rollback and re-upgrade cycle with zero data loss.

---

## Upgrade

Existing v2.3.1 installations upgrade through the normal ABUD Shorts updater:
double-click **ABUD Shorts - Update** on Windows, or `sudo abud-shorts update`
on Linux/VPS. No Git, source code, manual SQL or hand-edited Docker Compose
files are required.

The database schema remains `2.13.0`. No new migration is required beyond the
schema already carried by v2.3.1. Existing videos, jobs, media, brands,
settings, Provider Vault rows and publication history are all preserved. A
pre-upgrade backup is taken automatically before anything changes, and the
previous version is kept in place for rollback.
