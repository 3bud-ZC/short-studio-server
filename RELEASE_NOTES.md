# Short Studio 2.5.1

**Product:** Short Studio  
**Technical Product:** Short Studio Server  
**Release Version:** `2.5.1`  
**Release Channel:** stable  
**Stage:** General Availability Patch  
**Database Schema:** `2.13.0` (unchanged - no migration required)  
**Previous Release:** Short Studio `2.5.0`

Short Studio 2.5.1 is a customer-acceptance patch release delivering full language isolation, unified video creation, real Media Library production integration, improved quality review handling, template differentiations, and streamlined customer settings.

---

## What's New in 2.5.1

### Final Video Quality Contract & Needs Review
- **Separation of Hard Technical Failures vs. Soft Creative Warnings:** A technically valid 1080p render (valid container, active video stream, mastered audio, no silent dead-air, no black frames) is no longer discarded when a non-critical creative coverage or editorial preference falls short.
- **Needs Review (`needs_review`):** Videos meeting technical bars with soft warnings are preserved in `Needs Review` status, remain fully playable, previewable, downloadable, and visible in Video Library.
- **Localized Quality Findings:** The UI renders exact, translated quality findings in Arabic or English directly from structured message keys rather than generic server error strings.
- **Deterministic Technical Reference Codes:** Persistent, correlation-safe support codes (`ASE-...`) for every unique defect signature.

### Strict Language Isolation (Arabic & English)
- **Zero Language Mixing:** English interface displays 0 Arabic natural-language copy; Arabic interface displays 0 untranslated English natural-language sentences.
- **Directional & Layout Integrity:** Native RTL for Arabic with IBM Plex Sans Arabic / Noto Sans Arabic; native LTR for English. Zero horizontal overflow across mobile and desktop.
- **Localized System Vocabulary:** Full translation coverage for progress stages, quality findings, voice options, provider states, filters, empty states, and error alerts.
- **Technical Details Isolation:** Engineering identifiers, traces, and file paths are restricted exclusively behind collapsed, LTR-explicit Technical Details disclosures.

### Create Video: One Unified Experience
- **Single Intuitive Flow:** Removed the split between Simple/Advanced modes and Prompt/Template tabs. All settings are organized in clear customer sections: Prompt, Video, Voice, Media, Captions, and Review & Create.
- **Inferred Video Treatment:** Removed confusing "Video Type" and raw enum dropdowns; style and treatments are inferred automatically from prompt and chosen template.
- **Prompt Builder:** Built-in copyable meta-prompt builder in English and Arabic for external AI assistants to craft focused video briefs.

### Usable Media Library in Production
- **Real Media Strategy:** Full support for `Automatic`, `My Media Only`, `Prefer My Media`, `Stock Providers` (Pexels, Pixabay), and `Motion Graphics`.
- **Zero-Stock Guarantee on My Media Only:** Using "My Media Only" strictly utilizes uploaded customer assets with 0 external stock provider API calls.
- **Media Picker:** Integrated picker supporting search, image/video filtering, multi-select, preview, reordering, and removal.
- **Persistent Provenance:** Selected media IDs and asset origins are tracked through planning, rendering, and persisted in final output metadata.

### Customer Brands Streamlined
- **Brands Removed from Customer Navigation:** Removed Brands page, Brand Profiles requirement, and Brand Selectors from creation flows.
- **Historical Safety:** Existing brand rows and historical job associations in the database remain intact.

### 12 Distinct Practical Templates
- **Material Differentiation:** Built-in templates across 12 practical categories (Viral Short, Educational Explainer, Restaurant Promotion, Real Estate Listing, SaaS Promo, Product Promotion, Event Promotion, Business Tips, Curiosity/Facts, Story/Narrative, News/Update, Social Advertisement).
- **Unique Configurations:** Each template specifies distinct aspect ratios, durations, caption styling, animation intensity, and media policies.
- **Seamless "Use Template":** Prefills the unified Create Video form while keeping every option completely customizable.

### Refined Customer Settings & Operations
- **Focused Operational Controls:** Interface Language, Local Voice, Storage, Integrations shortcut, Backup & Restore, Updates, and Diagnostics.
- **Removed Distractions:** Production Defaults and customer Access Tokens removed from settings.
- **Safe Local Voice:** Default to local VoiceTut / KemeTone for Arabic and local Kokoro for English. Premium cloud voices (ElevenLabs) require explicit opt-in and confirmation.
- **Smart Retries:** Retrying jobs safely reuses verified voice, captions, and media assets without redundant regeneration or duplicate creation.

---

# Short Studio 2.5.0

**Product:** Short Studio
**Technical Product:** Short Studio Server
**Release Version:** `2.5.0`
**Release Channel:** stable
**Stage:** General Availability
**Database Schema:** `2.13.0` (unchanged from v2.4.0 - no migration required)
**Previous Product:** ABUD Shorts Engine `2.4.0`

Short Studio is the renamed, commercially productized continuation of ABUD
Shorts Engine. An installation upgraded from ABUD Shorts Engine 2.4.0 keeps its
existing database, videos, Provider Vault, backups and n8n data without
re-provisioning; `abud-shorts` remains available as a legacy CLI alias.

---

## What's New in 2.5.0

### Short Studio

The product is now Short Studio, with `short-studio` as the operator command,
Short Studio installer shortcuts, and consistent naming across the dashboard,
backups, packages and diagnostics. The schema is unchanged, so upgrading is a
version change, not a migration.

### A workstation you just open

Short Studio runs in `LOCAL_SINGLE_USER` mode on your own machine. The
dashboard opens directly with no sign-in step and no login barrier, and the
application binds strictly to `127.0.0.1` so nothing is exposed to your
network. A server deployment behind a real domain remains available and keeps
its own authenticated mode.

### Video engine

Production renders through the FFmpeg/hybrid engine, which is the supported
route for this release. Captions are rasterized with libass, which is what
makes Arabic shaping, joining and right-to-left layout correct in the final
frames rather than only in the preview.

### Arabic and English voice

Arabic uses the local VoiceTut route for high-quality Egyptian Arabic on your
own GPU, with a lighter local CPU route available on smaller machines. English
uses the local Kokoro route. Both run locally: no per-word cloud voice bill,
and no audio leaves the machine. ElevenLabs stays available as an optional
premium route you can select explicitly.

### Captions

Arabic and English captions are generated, timed and burned in with the Bold
Social style. This release corrects Arabic scene planning and duration handling
so the spoken audio, the scene timing and the caption timing agree.

### Publishing

Publishing goes to Upload-Post, which reaches YouTube, TikTok, Instagram,
Facebook, LinkedIn, X and Threads from one connected account. Pre-flight checks
your video against the destination's real limits before a byte is uploaded, and
each publication keeps a full attempt and event history.

### Publishing persistence (new in this release)

A successful publish is now recorded truthfully and automatically. Short Studio
persists the provider post id, the public URL, the remote state and the publish
time from the provider's own response, and a publication the platform is still
processing is settled automatically once the platform finishes. Replaying the
same provider result changes nothing, and the same idempotency key never
creates a second publication. No manual database work is required to complete
a publication.

### Encrypted Provider Vault

API keys are entered in the browser and stored AES-256-GCM encrypted. A stored
credential always takes precedence over an installation environment value, and
the dashboard tells you which source is actually in use. Secrets are never
returned through the API, never logged, and never included in a client package,
backup or diagnostics bundle.

### Media, production and library

Stock footage through Pexels and Pixabay, an AI production planner, a job queue
with live progress, and a library where every finished video, its metadata and
its publication history stay together.

### Operations

`short-studio status`, `doctor`, `backup`, `update` and `restart` cover the
day-to-day lifecycle. Backups are verified and checksummed, updates are staged
and reversible, and `doctor` produces a PASS/WARN/FAIL report that is safe to
share because it never prints secrets.

---

## Supported platforms for 2.5

| Platform | Status |
| --- | --- |
| Windows 11 with Docker Desktop, `LOCAL_SINGLE_USER` | **Qualified for this release.** |
| Linux host / VPS | Host scripts are provided and supported, but native Linux host qualification is not part of the Short Studio 2.5 release qualification, which was carried out on Windows. |

---

## Upgrading from ABUD Shorts Engine 2.4.0

The database schema is unchanged at `2.13.0`, so there is no migration to run.
Use the normal updater. Your videos, database, Provider Vault, backups and n8n
data are preserved, and the `abud-shorts` command keeps working.

---

## Known limitations

- Revideo remains experimental and is deferred beyond 2.5. Production rendering
  uses the FFmpeg/hybrid engine.
- Native Linux host qualification is deferred, as described above.
- The image is published for `linux/amd64` only.

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
