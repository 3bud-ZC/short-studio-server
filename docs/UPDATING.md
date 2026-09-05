# Updating Short Studio

This is the operator guide. There is no Git in it, because updating an
installation never involves Git, a source checkout or editing a compose file.

---

## Linux / VPS

Sign in to the server and run one command:

```bash
sudo short-studio update
```

That command does all of the following, in order, and stops at the first thing
that is not right:

1. Takes the update lock, so two updates can never run at once.
2. Reads the installed version.
3. Checks free disk space and the Docker service.
4. Downloads the release manifest from the published GitHub Release.
5. Confirms the release is on this installation's channel.
6. Downloads the client package and pulls the application image **by digest**.
7. Verifies the package SHA-256 and the image digest. A mismatch stops the
   update before anything is changed.
8. Creates a pre-update backup of the database and the configuration.
9. Records the version being replaced.
10. Stops only the application and the video engine. PostgreSQL and the
    automation service keep running.
11. Switches to the new release and starts it, which runs the migrations.
12. Waits for the health checks, then verifies the reported version, the
    database schema and the video engine.
13. Marks the update successful and keeps the previous version for rollback.

If any check after step 10 fails, the updater **rolls back automatically** to
the previous version, restores the pre-update database backup when the release
was not schema-compatible, brings the system back up, and confirms it is healthy
again.

### Other commands

```bash
sudo short-studio update --check
```

Reports whether an update is available and changes nothing.

```bash
sudo short-studio update --version 2.2.1
```

Installs one specific version. The version must be the one published on this
installation's channel; anything else is refused.

```bash
sudo short-studio rollback
```

Returns to the previous working version.

```bash
short-studio status
```

Shows health and the installed version.

```bash
sudo short-studio backup
sudo short-studio diagnostics
sudo short-studio restart
```

---

## Windows

Use the Start Menu, under **Short Studio**:

| Shortcut | What it does |
| --- | --- |
| **Short Studio - Update** | The full safe update above, including rollback |
| **Short Studio - Status** | Health and installed version |
| **Short Studio - Backup** | Creates a backup now |
| **Short Studio - Diagnostics** | Writes a support bundle |

No terminal and no Docker knowledge is needed. Double-click the shortcut and
read the result.

---

## From the browser

**Settings → Updates** shows the current version, the update channel, when the
system last checked, the latest published version and the release notes.
**Check for Updates** asks the update service right now.

The browser does not apply updates. The application is deliberately not given
control of Docker on the host, because that is equivalent to giving the web
application root. Settings → Updates therefore tells you the one command (or the
one shortcut) to run instead.

---

## Interrupted updates

If the terminal is closed, the SSH session drops or the machine restarts during
an update, the transaction record keeps the state it reached. The next
`sudo short-studio update` reports it, and starts a fresh verified update that
ends either healthy on the new version or rolled back to the old one.

`short-studio status` also reports an interrupted update.

---

## Rollback and the database

Most releases only add to the database: new nullable columns and new indexes.
The previous version can read that schema, so rolling back the code is enough.

When a release contains a change the previous version cannot read, its manifest
says so (`schemaBackwardsCompatible: false`). In that case rollback also
restores the pre-update database snapshot, and the updater reports that it did.
Code rollback alone is never presented as sufficient after an incompatible
schema change.

Pre-update backups are kept in `shared/backups` on Linux and in
`%ProgramData%\ShortStudio\shared\backups` on Windows (an installation
upgraded from ABUD Shorts Engine 2.4 keeps using its existing
`%ProgramData%\AbudShorts\shared\backups` instead).

---

## What an update never touches

Videos, uploaded media, brand profiles, templates, settings, connected social
accounts, publication history, backups and the provider credential vault all
live in the shared data area, outside every release directory. An update
replaces the release directory and the container image, and nothing else.

No update path runs `docker compose down -v`, removes a volume, or prunes.

---

## Automatic updates

Checking automatically is on and harmless. **Installing** automatically is off
and stays off: a production installation is updated when an administrator
decides to update it.
