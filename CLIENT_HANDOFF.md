# Short Studio 2.5.0 - Client Handoff

Short Studio is the renamed, commercially productized continuation of ABUD
Shorts Engine. An installation upgraded from ABUD Shorts Engine 2.4.0 keeps
its existing database, videos, Provider Vault, backups, and n8n data.

## What The Client Receives

- `Short-Studio-Server-2.5.0.tar.gz`
- `update-manifest.json`
- `Short-Studio-Server-2.5.0.tar.gz.sha256`
- Release notes and quick-start documentation

## Install

Windows: extract the package, then run the Short Studio installer in the
install folder and follow the Setup Wizard.

Linux/VPS (host scripts provided; native Linux host qualification is not part of the Short Studio 2.5 release qualification, which was carried out on Windows):

```bash
sudo ./install.sh --url https://shorts.yourdomain.com
```

## Operate

Linux/VPS:

```bash
sudo short-studio status
sudo short-studio update
sudo short-studio backup
sudo short-studio doctor
sudo short-studio restart
sudo short-studio rollback
```

(An installation upgraded from ABUD Shorts Engine 2.4 can keep using
`sudo abud-shorts <command>` - it is kept as a compatibility alias for the
same commands, it is just not the name new installs are shown.)

Windows: use the **Short Studio** Start Menu shortcuts (Start, Stop, Status,
Update, Backup, Doctor, Uninstall) created by the installer in the install
folder.

## First Setup

Open the installer URL with `/setup`, create the administrator account, add
optional provider keys, configure brand defaults and create the first video.

Arabic videos use the built-in Local Voice engine (VoiceTut Local High Quality,
with a lightweight fallback) by default - no provider key required. ElevenLabs
is an optional premium alternative a customer may configure and select
explicitly. Secrets are stored encrypted and are not returned in diagnostics or
package artifacts.

## Support

Use **Settings -> System -> Download Support Bundle** or run
`sudo short-studio doctor` / `sudo short-studio logs`. The bundle is designed
to redact passwords, API keys and OAuth tokens.
