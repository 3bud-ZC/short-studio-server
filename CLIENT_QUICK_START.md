# Short Studio — Quick Start

Everything below happens in an installer and a browser. You never edit a file,
type a Docker command or touch source code.

---

## 1. Install

### Windows

1. **Install Docker Desktop** from
   [docker.com](https://www.docker.com/products/docker-desktop/) and start it.
   Wait for the whale icon in the system tray to stop animating.
2. **Extract** the client package to a folder, for example
   `C:\Short-Studio-Server`.
3. **Double-click `INSTALL-SHORT-STUDIO.bat`.**
4. Wait. The installer checks Docker, generates this machine's own secrets,
   creates the storage folders, downloads the application and starts it.
5. When it finishes it prints your address, normally
   `http://localhost:3130`, and opens the Setup Wizard in your browser.

### Linux or a server

See `docs/SERVER_INSTALL.md`. In short:

```bash
sudo ./install.sh --url https://shorts.yourdomain.com --behind-proxy
```

---

## 2. First setup

Open the address the installer printed, followed by `/setup`:

```
http://localhost:3130/setup
```

The Setup Wizard asks you to:

1. **Create your administrator account.** You choose the password. There is no default password anywhere in this product.
2. **Add a free Pexels key** for stock footage (optional, but recommended).
3. **Set your brand** — name, colours, logo.

That is it. You are on the dashboard.

---

## 3. Create your first video

1. **Create Video**.
2. Choose **Prompt** (describe what you want) or a **Template** such as Product
   Ad or Restaurant Promo.
3. Pick language, length and aspect ratio.
4. **Generate Video**.

Progress appears live. The finished video lands in **Video Library**, where you
can play it, download it or send it to **Publishing**.

Arabic narration uses the built-in Local Voice engine by default - no setup, no
key, no per-video cost. Prefer a premium cloud voice instead? Add your
ElevenLabs key in **Integrations → ElevenLabs → Configure** and select it
explicitly for a video; the key is stored encrypted and never written to a
file you have to manage.

---

## 4. Connect your social accounts

**Integrations** → choose YouTube, TikTok or Instagram → **Connect**.

Each provider shows the exact callback URL to paste into its developer console.
That URL is built from your installation's public address, so a server on your
own domain shows your domain, not `localhost`.

---

## 5. Backups

**Settings → Backup & Restore**.

- **Create Database + Config Backup** — settings, brands, templates, job and
  publication history.
- **Create Full Media Backup** — the above plus your video files.
- **Download** keeps a copy off this machine.
- **Restore** puts a backup back. A safety snapshot is taken first, and you are
  asked to confirm before anything is replaced.

Every backup shows when it was made, its type, its size, the version and
database schema it came from, and its checksum.

A backup is also created automatically before every update.

---

## 6. Update

**Settings → Updates** shows your current version, the latest published version
and the release notes, and checks on demand.

To install an update:

| Where you installed | What to do |
| --- | --- |
| Windows | Double-click `UPDATE-SHORT-STUDIO.bat`, or Start Menu → **Short Studio → Short Studio - Update** |
| Linux / server | `sudo short-studio update` |

The updater takes a backup first, verifies the download before installing it,
checks the system is healthy afterwards, and puts the previous version back
automatically if anything is wrong.

Full details, including rollback: `docs/UPDATING.md`.

---

## 7. If something looks wrong

1. **Settings → System** shows whether each part of the system is healthy.
2. **Download Support Bundle** writes a diagnostic file with your version,
   database schema, service health and recent errors. It contains no passwords
   or API keys, so it is safe to send to support.
3. **Restart**: Start Menu → **Short Studio - Status** on Windows, or
   `sudo short-studio restart` on Linux. Restarting never removes data.

---

## 8. Uninstalling

| Windows | Linux |
| --- | --- |
| `.\uninstall.ps1` | `sudo ./uninstall.sh` |

The default removes the software and **keeps every video, backup and setting**.
Erasing your data requires an explicit flag and a typed confirmation.
