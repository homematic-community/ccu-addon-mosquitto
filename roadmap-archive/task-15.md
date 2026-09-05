# Task 15 — Persistence on a USB stick, configurable in the UI ✅

Maintainer's wish (like RedMatic's context-storage path), completed 2026-09-05.

- `persistence_location` is a managed key of the configuration model. The
  persistence card has a **Speicherort** selector: the addon directory
  (`var/`), every USB stick the CCU has mounted under `/media/usb<N>`
  (filesystem and free space shown), or a custom path. A stick gets a
  `mosquitto/` subdirectory so other addons can share it.
- `www/media.cgi` (session, Tcl 8.2): `cmd=list` reads `/proc/mounts`
  (only real mounts count — on the CCU3 the mount points usb1..usb8 always
  exist as empty directories on a tmpfs), `cmd=check` reports mounted /
  exists / writable / free MB for the configured location; the page shows
  it under the selector, a configured but unplugged stick in red.
- `bin/mosquitto-service` creates a missing persistence directory at
  start, but never below `/media` unless the stick is mounted there (data
  on the tmpfs would be lost at reboot) — it logs a warning instead and
  Mosquitto starts without its saved state.
- Tests: parser unit test (default, stick path written in place, absent
  stays absent), e2e step (new location created by the service, retained
  message survives a restart from there). Lab: no stick available, so a
  bind mount of an ext4 directory at `/media/usb1` on the CCU3 stood in —
  `media.cgi` listed it with free space, the page switched between stick,
  custom path and addon directory, the service created the directory on
  the mounted stick and refused to on the tmpfs after the unmount.
