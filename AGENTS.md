# Agent instructions for ccu-addon-mosquitto

ccu-addon-mosquitto packages the [Mosquitto](https://mosquitto.org/) MQTT
broker (plus `mosquitto_sub`, `mosquitto_pub`, `mosquitto_ctrl`,
`mosquitto_passwd`) as an addon for the Homematic CCU3 / OpenCCU (formerly
RaspberryMatic) smart-home central. The build output is one `.tar.gz` addon
package per architecture (armv7l, aarch64, x86_64), installed on the CCU
under `/usr/local/addons/mosquitto`.

**Read `ROADMAP.md` before making changes.** Completed tasks live in
`roadmap-archive/` (one file per task, numbers are never reused).

## Layout

- `build.sh` → `build_addon.sh <arch>` — resolves the Mosquitto packages and
  their shared-library closure from the Alpine package index
  (`alpine-packages.mjs`), makes the musl binaries self-contained with
  `patchelf` (interpreter + RPATH inside the addon prefix), copies
  `addon_files/`, writes `versions` and `www/licenses.html`, tars the result
  into `dist/` with a `.sha256` sibling.
- `addon_files/update_script` — what the CCU runs at install/update time
  (fresh install exits 10 = reboot, update exits 0 and starts the service).
- `addon_files/mosquitto/` — the addon skeleton that ends up on the CCU:
  - `bin/mosquitto-service` — start/stop/restart/reload/status/info/uninstall
    (linked as `/usr/local/etc/config/rc.d/mosquitto`)
  - `bin/mosquitto-update` — self-update worker started by `www/update.cgi`
  - `bin/update_addon` — tclsh script that registers/removes the
    configuration button in the CCU's `hm_addons.cfg`
  - `etc/mosquitto.conf.default` — the default config, copied to
    `etc/mosquitto.conf` on first install only; on the CCU that file is
    owned by the user (UI + command line)
  - `www/` — settings page (tclsh CGIs + one HTML + one CSS + one JS, no
    frameworks), `lib/` — shared tcl helpers (session check, query string)

  The package also runs on openccu-lite (no ReGaHSS, systemd): `lib/session.tcl`
  is the addon's only ReGa call and its `tclrega.so` shim answers exactly that
  one — do not add others. Two places detect the box at runtime instead of
  assuming a CCU: the pid file leaves `/var/run` when the script is not root
  (openccu-lite can run an addon as `addon-mosquitto`), and `Status()` /
  `log.cgi` read the journal when there is no `/var/log/messages`. See
  `roadmap-archive/task-19.md` and the README's openccu-lite section.
- `build_in_container.sh` — runs inside the Alpine build container.
- `test/` — `node:test` suites (Node.js is a test tool only, nothing of it
  ships): `parser.test.js` (unit, the mosquitto.conf model of the page),
  `e2e.test.js` (the built x86_64 package in a Debian container the test
  starts itself; broker checks with the `mqtt` npm client; needs docker),
  `webui.test.js` (the settings page and CGIs through lighttpd in that
  container, headless chromium via playwright, every UI path against the
  broker, coverage of `www/js/script.js`). Shared helpers in `test/lib/`.
- `update_versions.js` — checks the newest Mosquitto release tag against
  the pinned version and bumps `package.json` (used by `auto-release.yml`).
- CI: `.github/workflows/ci.yml` (syntax, 3-arch build, e2e), `build.yml`
  (manual release build), `auto-release.yml` (daily automatic releases on
  new Mosquitto versions).

## Conventions & caveats

- **ALWAYS use WSL instead of PowerShell** for shell commands (git, build
  scripts, ssh to test systems). PowerShell introduces problems with line
  breaks (CRLF vs LF), quoting and git ownership on `\\wsl.localhost` paths.
- One git commit per significant change. **Never push, tag or release**
  without the maintainer's go — releases are cut by the GitHub workflows.
- Versions: `<mosquitto version>+<addon build>` in `package.json`
  (`2.1.2+0`, `2.1.2+1`, …); tags and asset names carry the literal `+`
  (no `v` prefix, like the old `1.5.8+4` releases). Assets are
  `mosquitto-<arch>-<version>.tar.gz` for all three architectures; armv7l is
  published under its historical `mosquitto-<version>.tar.gz` as well (the same
  file, two names — addon catalogues resolve the first, old links the second).
  Pushing a tag that equals the `package.json` version runs `build.yml` and
  publishes the release.
- The addon scripts run on busybox `ash` on the CCU — POSIX `sh` only, no
  bashisms in `addon_files/`. Build scripts are bash and run on Linux CI.
- No `LD_LIBRARY_PATH` anywhere: the bundled binaries find their musl
  libraries via their patched RPATH; exposing `lib/` globally would poison
  glibc firmware binaries.
- Target runtime is an embedded Linux box (CCU3: ARM, 1 GB RAM, no compiler,
  tclsh CGIs behind lighttpd). Keep the package small — no web frameworks
  in `www/`.
- The configuration UI parses and rewrites `etc/mosquitto.conf` in the
  browser (managed keys + verbatim passthrough); keep the parser and the
  default config in sync when adding directives.
- Lab test systems, their addresses and credentials stay out of the repo,
  the wiki and issues.
