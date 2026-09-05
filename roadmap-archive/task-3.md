# Task 3 — Addon runtime: service script, installer, migration ✅

Completed 2026-09-05.

- `bin/mosquitto-service` (linked as `rc.d/mosquitto`): start / stop /
  restart / reload (SIGHUP) / status (JSON: running, pid, rss, vsz, start
  time; when stopped the last Mosquitto error line from the syslog) / info
  (with `Config-Url`) / uninstall. `start-stop-daemon` with a pid file,
  pid recovery via `pidof` when the pid file is stale, `cd /` before the
  start (the OpenCCU installer's temp dir vanishes), `.nobackup` markers
  on `bin`, `lib`, `www`.
- `bin/update_addon`: a tclsh script that registers/removes the WebUI
  button in `hm_addons.cfg` (flat `array get` list) — instead of
  RedMatic's i386/armv7 ELF helpers, which only run through the CCUs'
  32-bit compat loaders. Tcl 8.2 compatible (no `dict`).
- `update_script`: architecture check against `versions` (exit 13),
  mount check, stop on update, wipe `bin`/`lib`/`www`/old `rc.d`, copy,
  `etc/mosquitto.conf` from `mosquitto.conf.default` on first install only
  (without the TLS blocks when `/etc/config/server.pem` is missing), links,
  button, exit 10 on a fresh install, exit 0 and service start on updates
  unless the CCU3 firmware installs at shutdown (`S00InstallAddon`).
- Migration from 1.5.8+x: `conf.d/*.conf` and `*.conf.disabled` folded
  into one `mosquitto.conf` (old `include_dir` line dropped, directory
  kept as `conf.d.old`), `allow_anonymous true` added when the old config
  had no auth (Mosquitto 2.x defaults to false — found by the e2e test),
  old libraries gone. Verified on the CCU3 with the real 1.5.8+4 release
  and custom ports (task 8).
- Default config: `user root`, listeners 1883, 1884 (websockets), 8883 and
  8884 with the CCU certificate (task 12), `allow_anonymous true`,
  persistence in `var/`, `log_dest syslog`, four log types,
  `connection_messages true`.
