# Installing Short Studio on a server

Short Studio is the renamed, commercially productized continuation of ABUD
Shorts Engine 2.4.0. The paths and commands below are unchanged for this
release - `install.sh` and the `abud-shorts` command have not been renamed
yet, so a fresh install still lands under `/opt/abud-shorts` and installs
the `abud-shorts` binary.

For a Linux VPS reached at a real domain. For a Windows workstation, see
`CLIENT_QUICK_START.md`.

---

## Before you start

- A Linux server with Docker Engine and the Docker Compose plugin.
- 4 CPU cores, 8 GB RAM and 40 GB free disk, minimum.
- A domain name pointing at the server, for example `shorts.example.com`.

---

## Install

```bash
tar -xzf ABUD-Shorts-Engine-2.4.0.tar.gz
cd ABUD-Shorts-Engine-2.4.0
sudo ./install.sh --url https://shorts.example.com --behind-proxy
```

That is the whole installation. There is no repository to clone, no compose file
to edit and no image to build: the installer pulls the published application
image, generates this machine's own secrets, creates the persistent directories
and starts the system.

Then open `https://shorts.example.com/setup` and create the administrator
account. There is no default password anywhere in the product.

Options:

| Option | Purpose |
| --- | --- |
| `--url https://…` | The public address. OAuth callbacks derive from it. |
| `--port 3130` | The port the application listens on behind the proxy. |
| `--home /opt/abud-shorts` | Where the installation lives. |
| `--behind-proxy` | Honour `X-Forwarded-*` from your reverse proxy. |

---

## What gets created

```
/opt/abud-shorts/
  current -> releases/2.4.0
  releases/2.4.0/     this release
  shared/                  everything you own
    data/                  videos, uploads, media, models
    config/.env            this machine's secrets
    backups/               pre-update snapshots
    logs/
    installation.json
```

Updating replaces a release directory. It never writes inside `shared/`, which
is why your videos, settings and backups survive every update.

---

## Reverse proxy

Only the application is published; PostgreSQL, n8n and the render worker have no
host port at all and stay on the internal Docker network.

`nginx.conf.reference` in this package is a working starting point. It covers
HTTPS, the proxy headers the application needs, server-sent events for live job
progress, byte-range requests for video playback, large uploads and the OAuth
callback path.

After the proxy is in front, install with `--behind-proxy`, or tell the
application so it will trust the forwarded protocol and host:

```
TRUSTED_PROXY=1
```

in `/opt/abud-shorts/shared/config/.env`, then `sudo abud-shorts restart`.

`--url` only sets the canonical public address used for OAuth callbacks and
shared links. Forwarded headers are ignored unless `--behind-proxy` or
`TRUSTED_PROXY` is explicitly configured, which is the right default for a
server reached directly.

This also works behind Cloudflare. Cloudflare terminates TLS and forwards
`X-Forwarded-Proto: https`, which the application honours once `TRUSTED_PROXY`
is set, so the callback URLs it shows you are the `https://` ones your customers
actually use.

---

## Changing the address later

**Settings → System → Public address**. Save the new address and the OAuth
callback URLs on the Integrations page update with it. Re-register the new
callback URL in each provider's console. No file needs editing.

---

## Day to day

```bash
abud-shorts status        # health and version
sudo abud-shorts update   # install the latest version, safely
sudo abud-shorts backup   # snapshot now
sudo abud-shorts restart
sudo abud-shorts rollback # return to the previous version
```

See `docs/UPDATING.md` for the full update and rollback behaviour.

---

## Uninstalling

```bash
sudo ./uninstall.sh
```

Removes the containers and keeps every video, backup and setting. Erasing data
requires `--remove-data` and a typed confirmation.
