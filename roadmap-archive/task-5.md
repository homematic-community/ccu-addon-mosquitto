# Task 5 — Self-update from the settings page ✅

Completed 2026-09-05 (`www/update.cgi`, `bin/mosquitto-update`).

- RedMatic's task-11 worker without the progress model: `update.cgi`
  starts `bin/mosquitto-update` detached (`setsid`), the worker copies
  itself to `/tmp/mosquitto-update/` (the install replaces the tree) and
  writes `state.json` (phase, message, version, installed, error, reboot,
  elapsed, ts) that the page polls; the modal shows a spinner with the
  phase and the log on error.
- Phases: resolve (GitHub `releases/latest`, `tag_name` with or without
  `v`), preflight (stale `/usr/local/tmp/tmp.*` dirs and archive released
  and removed, another installer running, free space and inodes — 300 MB
  / 20k inodes on the CCU3 firmware because of its chroot copy, 50 MB / 2k
  elsewhere), download (`curl`, URL with `+` encoded as `%2B`), verify
  (`.sha256`), install (`/bin/install_addon` when present, else extract +
  `update_script`), start (when the firmware did not), done.
  `vercmp` understands `<x.y.z>+<n>`; refuses when not newer unless
  `--force`. `MOSQUITTO_UPDATE_BASE_URL` overrides the download location
  for tests.
- Verified: e2e (busybox httpd), OpenCCU x86_64 with the real
  `/bin/install_addon` fed through lighttpd (`www/test/`): 1 s end to end.
