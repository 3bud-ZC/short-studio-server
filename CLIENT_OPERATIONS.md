# Short Studio - Operations Guide

One place for everything after the first install: day-to-day operation,
updates, backup/recovery, and troubleshooting. Everything here uses the
supported product lifecycle - never Git, source edits, manual SQL, `docker cp`,
or manual container commands.

**Windows:** use the Start Menu shortcuts under **Short Studio**, or run
`scripts\host\short-studio.ps1 <command>` from an installed release directory.
This is the qualified route for 2.5.
**Linux/VPS:** run `sudo short-studio <command>`. The Linux host scripts are
provided and supported, but native Linux host qualification is not part of the Short Studio 2.5 release qualification, which was carried out on Windows.
(`abud-shorts` remains as a compatibility alias for installations upgraded from 2.4.)

---

## Everyday commands

| Command | What it does |
| --- | --- |
| `status` | Version, channel, and the health of every service |
| `start` / `stop` / `restart` | Full lifecycle - your data is never touched |
| `doctor` | A PASS/WARN/FAIL health report for support - safe to share, never prints secrets |
| `logs [app\|worker\|postgres\|n8n\|local-voice]` | Recent logs for one service, or all of them |
| `backup` | A database and configuration backup, on demand |
| `diagnostics` | Writes a full support bundle to a file |
| `update` | Installs the latest **stable** version, safely |
| `rollback` | Returns to the previously installed version |
| `owner reset-password` | Recovers a lost owner username/password, locally |
| `local-voice status` / `local-voice repair` | Local Arabic voice health and self-repair |

Run any command with no arguments to see this list again.

---

## First login and provider setup

1. Open the installer URL and finish the Setup Wizard - this creates the one
   owner account. There is no default password anywhere in the product.
2. From **Providers**, add any optional API keys (Pexels for stock footage,
   ElevenLabs for premium Arabic voice, publishing platforms, etc). Keys are
   stored encrypted; the interface never shows a saved key back to you,
   only a masked hint and a health status (Not configured / Configured /
   Healthy / Invalid / Unavailable).
3. **Local Voice** (Egyptian Arabic) installs automatically during setup on
   Windows if your hardware supports it - no separate download step, no
   terminal. Check its state any time from **Settings -> Providers** or with
   `local-voice status`.

## Create your first video

Dashboard -> **Create Video** -> choose Prompt or Template -> pick language,
length and aspect ratio -> **Generate**. Progress is shown live. Finished
videos are in **Video Library**, where you can preview, download, or send a
video to **Publishing**.

## Publishing

Each platform in **Publishing -> Connections** shows one of: Not connected,
Connected, Authorization expired, Healthy, or Unavailable. Connecting uses
the platform's own sign-in (OAuth) - ABUD never asks for that platform's
password directly. A platform still awaiting approval from that platform
shows *Configured / Awaiting Platform Approval*, never a fake "Healthy."

## Backup and restore

`backup` creates an on-demand database and configuration snapshot
(`includesSecrets: false` - no plaintext key or password is ever in a
backup). Every `update` also takes one automatically before changing
anything. Backups live under the shared data directory
(`shared\backups` on Windows) alongside your videos and settings - never
inside a release directory, so they survive every update.

Restoring a backup, or reversing an update, is a **rollback**: run
`rollback` to return to the previously installed version with your data
exactly as it was before the update. There is no separate "restore" step for
ordinary use - rollback is the supported recovery path.

## Update and rollback

Installations are on the **stable** channel by default. `update` checks
for the newest published stable release and reports whether one is
available; installing it always requires you to run `update` yourself - it
never installs automatically or silently. Every update: verifies the
download by checksum, verifies the application image by its exact published
digest, takes a pre-update backup, and health-checks the new version before
finishing. If anything about the new version does not check out, nothing
changes.

If a version ever causes a problem, `rollback` returns to the previous
version immediately, with your data intact.

## Restart after a reboot

Windows: Docker Desktop and ABUD Shorts's containers restart automatically
once Docker Desktop is running. Local Voice starts automatically at login
(a per-user task, or an equivalent Startup entry on machines where Windows
does not allow that account to create scheduled tasks) - either way, no
manual step and no developer terminal. If Docker Desktop itself is not
running yet, `status` or `start` reports that clearly rather than failing
silently; start Docker Desktop and run the command again.

## Account recovery

Forgot the owner username or password? Run `owner reset-password` on the
machine itself. It asks for the new username/password interactively (never
as a command-line argument, never echoed), signs out every existing
session, and touches nothing else. No email and no external service is
involved.

## Troubleshooting

1. Run `doctor` first - it is built for exactly this and is safe to read
   over the phone or paste into a support request (it never contains a
   password, token, API key, or session value).
2. If it points at one service, `logs <that service>` shows what actually
   happened.
3. Still stuck? Run `diagnostics` to write a full, secret-redacted support
   bundle, and send that file to support.

Common situations `doctor` distinguishes clearly: Docker Desktop not
running, a port already used by something else, the database or automation
service not reachable, Local Voice not set up or needing repair, low disk
space, and whether the update service is reachable right now.
