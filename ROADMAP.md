# ccu-addon-mosquitto Roadmap

Planned direction for ccu-addon-mosquitto (the Mosquitto MQTT broker as a
Homematic CCU3 / OpenCCU addon). The overall theme, in the footsteps of
RedMatic 9: **modernize the whole stack, keep the package minimal, release
automatically for every Mosquitto release.**

Convention (same scheme as RedMatic and node-red-contrib-ccu): task numbers
are stable and never reused. This file holds only open items — when a task
is completed, its content moves to [roadmap-archive/](roadmap-archive/) (one
file per task, e.g. `task-1.md`) and its line in the contents below gets a
✅ marker linking into the archive.

Status 2026-09-05: work started. The last release is **1.5.8+4**
(2022-06-18): Mosquitto 1.5.8 with OpenSSL 1.1 and libwebsockets 8, binaries
checked into git, no configuration UI, a raw-VERSION update check, armv7l
only. Everything below replaces that.

## Contents

- [1. Repository and tooling modernization](#1-repository-and-tooling-modernization)
- [2. Build from Alpine packages for three architectures](#2-build-from-alpine-packages-for-three-architectures)
- [3. Addon runtime: service script, installer, migration](#3-addon-runtime-service-script-installer-migration)
- [4. Configuration web UI](#4-configuration-web-ui)
- [5. Self-update from the settings page](#5-self-update-from-the-settings-page)
- [6. Continuous integration and end-to-end test](#6-continuous-integration-and-end-to-end-test)
- [7. Version scheme and automatic releases](#7-version-scheme-and-automatic-releases)
- [8. Hardware verification on the lab systems](#8-hardware-verification-on-the-lab-systems)
- [9. Documentation](#9-documentation)
- [10. First release](#10-first-release)
- [11. Bridge setup in the web UI](#11-bridge-setup-in-the-web-ui)
- [12. TLS listeners in the default configuration](#12-tls-listeners-in-the-default-configuration)
- [13. CCU firewall: show blocked ports, open them from the UI](#13-ccu-firewall-show-blocked-ports-open-them-from-the-ui)

## 1. Repository and tooling modernization

- Remove the checked-in binaries (`addon_files/mosquitto/bin`, `lib`) — they
  are build output now (task 2).
- `.gitattributes` (`* text=auto eol=lf`), `.editorconfig`, renormalized
  checkout (the current Windows clone carries CRLF noise on every file).
- `AGENTS.md` (+ `CLAUDE.md` pointing to it) with layout, conventions and the
  WSL-only rule; `ROADMAP.md` + `roadmap-archive/` (this scheme).
- `package.json` only as the single place for the addon version and the
  build/test scripts — no Node.js on the CCU, and none needed at build time
  beyond what the Alpine resolver script uses.
- Keep the repository's dual EPL-1.0/EDL-1.0 license files; Mosquitto 2.x
  itself is EPL-2.0/EDL-1.0 — the bundled component licenses are listed in
  the addon's licenses page (task 4).

## 2. Build from source in Alpine containers for three architectures

Same self-contained-musl approach as RedMatic's armv7l Node.js runtime, now
for all three targets: `build_addon.sh <armv7l|aarch64|x86_64>` compiles
the official Mosquitto source tarball inside an Alpine container of the
target architecture (`build_in_container.sh`, docker + qemu/binfmt for
ARM) with a minimal feature set, copies the binaries plus the transitive
shared-library closure (`patchelf --print-needed`: musl, OpenSSL 3, cJSON)
and the musl loader into the addon tree and rewrites interpreter and RPATH
to `/usr/local/addons/mosquitto/lib`. The CCU's own libc (glibc 2.27 on the
CCU3 firmware, current glibc on OpenCCU) is irrelevant, the runtime is
self-contained. No `LD_LIBRARY_PATH` anywhere (it would poison firmware
binaries with musl libraries).

Why not Alpine's own mosquitto package (the first attempt, 2026-09-05):
Alpine builds with the HTTP API (libmicrohttpd → gnutls, nettle, gmp,
p11-kit, libidn2, …), sqlite persistence, libwebsockets and editline — 17
MB unpacked / 7.4 MB compressed for features the addon does not use, versus
7.7 MB / 3.3 MB from the source build. And the source build makes a
release possible on the day of a Mosquitto release, independent of the
distribution's packaging.

- Shipped: `bin/mosquitto`, `mosquitto_sub`, `mosquitto_pub`,
  `mosquitto_ctrl`, `mosquitto_passwd`, the `mosquitto_password_file.so`
  and `mosquitto_acl_file.so` plugins (Mosquitto 2.1 deprecates the
  `password_file`/`acl_file` options in favour of these plugins; they are
  the same code) and `mosquitto_dynamic_security.so` (maintainer's
  request 2026-09-05: available for command-line use with
  `mosquitto_ctrl dynsec`, not managed by the UI). Not shipped:
  persist-sqlite and sparkplug plugins, `mosquitto_rr`,
  `mosquitto_db_dump`, `mosquitto_signal`, C++ bindings.
- Feature set of the build: TLS (+PSK), built-in websockets (2.1+, no
  libwebsockets), bridges, persistence, `$CONTROL` (DynSec), unix
  sockets; off: HTTP API, sqlite persistence, editline, SRV/c-ares,
  SOCKS, systemd, docs. Libraries follow from the closure: musl, OpenSSL
  3, cJSON (from the Alpine release of the container, `alpine:3.22`).
- The version in `package.json` is `<mosquitto>+<addon build>`; the build
  compiles exactly that Mosquitto version (mosquitto.org tarball, GitHub
  tag archive as fallback).
- Build writes `versions` (VERSION_ADDON, MOSQUITTO_VERSION, ADDON_ARCH,
  ALPINE_VERSION, package versions of the bundled libraries),
  `www/licenses.html` (components, versions, licenses and upstream URLs
  from apk's installed database) and `.sha256` siblings next to the
  tarballs in `dist/`. Checksum files carry the bare file name (RedMatic's
  had the build machine's absolute path).
- Package names as before: `mosquitto-<version>.tar.gz` (armv7l, CCU3),
  `mosquitto-aarch64-<version>.tar.gz`, `mosquitto-x86_64-<version>.tar.gz`.
- Self-check at the end of the build: every DT_NEEDED entry of every
  shipped ELF is in `lib/`, interpreter inside the prefix.

## 3. Addon runtime: service script, installer, migration

- `bin/mosquitto-service` (linked as `rc.d/mosquitto`): start / stop /
  restart / reload (SIGHUP) / status / info / uninstall. `start-stop-daemon`
  with a pid file, `-c etc/mosquitto.conf`, syslog via `log_dest syslog`
  (busybox syslogd → `/var/log/messages`, tag `mosquitto`). `info` carries
  `Config-Url` so the CCU WebUI shows the configuration button;
  `bin/update_addon` registers the button in `hm_addons.cfg` — a tclsh
  script doing what the firmware's `::HomeMatic::Addon::AddConfigPage`
  does (the CCU3 firmware has no `RemoveConfigPage`), instead of the
  opaque 32-bit `update_addon` binaries RedMatic carries under `tools/`
  (i386/armv7 ELFs that only run through the CCUs' compat loaders).
- `update_script`: mount check, stop the running service, copy the tree,
  create links (`rc.d`, `www`), exit 10 on a fresh install (the CCU3
  firmware reboots), exit 0 and start the service itself on an update
  (OpenCCU installs live — the RedMatic #599 lesson).
- Default configuration on first install (`etc/mosquitto.conf`, written
  only when absent): `user root`, `listener 1883`, `listener 1884
  websockets`, `allow_anonymous true`, `persistence true` in `var/`,
  `log_dest syslog`, `log_type error warning notice information`. The
  TLS listeners (8883 mqtt, 8884 websockets) are not part of the default
  — the UI enables them (task 4).
- Migration from 1.5.8+x: the old layout had `etc/mosquitto.conf` with
  `include_dir etc/conf.d/` and one file per listener, with the service
  script renaming the TLS listener files to `.disabled` when
  `/etc/config/server.pem` was missing. `update_script` folds the
  `conf.d/*.conf` files into one `mosquitto.conf` (old `include_dir` line
  removed, the directory kept as `conf.d.old`) so the UI's parser sees a
  single file; stale `libcrypto.so.1.1`, `libwebsockets.so.8` etc. are
  deleted with the old `lib/` and `bin/`. `persistence_location` moves to
  the new tree.
- `mosquitto` runs as root (`user root`): the CCU has no `mosquitto`
  user and the broker would otherwise try to drop privileges. Backups:
  `.nobackup` markers on `bin`, `lib`, `www` like RedMatic (only `etc`
  and `var` are worth backing up).
- Uninstall: stop, remove links, tree, `hm_addons.cfg` entry.

## 4. Configuration web UI

Served by the CCU's lighttpd from `/addons/mosquitto/` (tclsh CGIs with the
same `check_session` as RedMatic — every write and every read of the
configuration needs a valid CCU session). Look and feel copied from
RedMatic's settings page, but **without** Bootstrap, jQuery and Font
Awesome (that is ~2 MB of `node_modules` in RedMatic): one hand-written
stylesheet in the Bootstrap 4 card look, vanilla JS, no build step.

Configuration model, borrowed from [she](https://github.com/hobbyquaker/she)
(`src/lib/mosquitto-conf.js`): the browser reads `etc/mosquitto.conf` as
text (`getconfig.cgi`), parses the **managed keys** into a structure and
keeps every other line as verbatim passthrough, then writes the whole file
back (`setconfig.cgi`). Hand edits on the command line survive; there is no
raw editor in the UI (maintainer's decision), no mTLS and no DynSec.

Managed keys and the cards on the **Konfiguration** tab:

- **Prozess**: status (running/stopped, pid, memory, uptime via
  `service.cgi?cmd=ps`), buttons start / stop / restart / reload.
  Hint that the CCU3 firewall needs the listener ports opened.
- **Listener** (one card per `listener` block): port, bind address,
  protocol (mqtt / websockets), TLS on/off. With TLS: `certfile`,
  `keyfile` (defaults from the certificate card), `tls_version`
  (default / tlsv1.2 / tlsv1.3). `max_connections` optional. Add and
  remove listeners. Sub-keys not in the model (e.g. `mount_point`) pass
  through untouched inside the listener block.
- **Zertifikat**: which server certificate the TLS listeners use —
  the CCU's own `/etc/config/server.pem` (cert and key in one file, the
  default and what 1.5.8 used), a self-signed certificate generated on
  the CCU with `openssl` (`cert.cgi`: CN = hostname, SANs = hostname and
  current IPs, 10 years, into `etc/certs/`), or custom paths. Shows
  subject, issuer and expiry of the selected certificate.
- **Authentifizierung**: `allow_anonymous` true/false; password file
  on/off (plugin `mosquitto_password_file.so` with `etc/passwd`); user
  list with add / set password / delete via `passwd.cgi` running
  `mosquitto_passwd -b` / `-D` (password in the POST body, never in the
  query string). ACL file: on/off with `etc/acl` (plugin
  `mosquitto_acl_file.so`) — the file itself is edited on the command
  line, the UI only toggles it. After every change the page offers
  "Übernehmen" = reload (SIGHUP, enough for password/ACL changes) or
  restart (listeners, TLS, plugins).
- **Logging**: `log_dest` fixed to syslog; `log_type` checkboxes (error,
  warning, notice, information, debug, subscribe, unsubscribe,
  websockets); `connection_messages`.
- **Persistenz**: `persistence` on/off, `autosave_interval`,
  location fixed to `var/`.

Further tabs: **Debug** (log download of the mosquitto lines from
`/var/log/messages` plus `versions`, `df`, `netstat`, iptables — like
RedMatic's `log.cgi`) and **Lizenzen** (the generated `licenses.html`).
Version and update notice in the navbar as in RedMatic.

## 5. Self-update from the settings page

RedMatic task 11, simplified: `www/update.cgi` starts
`bin/mosquitto-update` detached (`setsid`), the worker writes a small JSON
state file in `/tmp/mosquitto-update/` (phase, message, version, error)
that the page polls; **no progress bars** — the packages are a few MB and
install in seconds, a spinner with the current phase and the log on error
is enough. Phases: resolve (GitHub releases API, only full releases,
`assets[]` gives the URL), preflight (free space, no other installer
running, stale `/usr/local/tmp/tmp.*` dirs), download (`curl`, the CCU3
firmware's curl 7.61 reaches GitHub fine), verify (`.sha256`), install
(`/bin/install_addon` when present, else extract + `update_script` by
hand), start (if the firmware did not), done. The worker copies itself to
tmpfs first because the install replaces the tree. Refuses when the
installed version is not older. `update_check.cgi` compares
`<mosquitto>+<n>` versions correctly (`2.1.2+0` > `1.5.8+4`,
`2.1.2+1` > `2.1.2+0`).

## 6. Continuous integration and end-to-end test

- `ci.yml`: shell syntax (`sh -n`, `bash -n`), shellcheck where available,
  three-arch build matrix with artifacts, e2e job on the x86_64 package.
- `test/e2e.sh` + `test/e2e-inner.sh`: Debian container (linux/amd64),
  busybox `sh` and `syslogd` like the CCU, replays OpenCCU's
  `install_addon` (fresh install → exit 10, update → exit 0 + restart),
  then: broker answers on 1883, pub/sub round trip with the bundled
  clients, websockets listener answers, password file: anonymous refused
  and user accepted after `passwd` changes + reload, TLS listener with a
  generated self-signed certificate, the config parser round trip (the
  CGIs' file read/write), the self-update worker against a local
  `busybox httpd` with `--force`, migration from a 1.5.8-style `conf.d`
  layout, clean stop and uninstall.
- `build.yml`: manual release build (workflow_dispatch) → tag
  `<version>` (no `v`, as the old releases), draft prerelease with the
  three tarballs, `.sha256` files and the release body.

## 7. Version scheme and automatic releases

Addon version = `<mosquitto version>+<addon build>`: the first package of
Mosquitto 2.1.2 is `2.1.2+0`, an addon-only change on the same Mosquitto
becomes `2.1.2+1`, the next Mosquitto release starts again at `+0`.
Tags and asset names carry the literal `+` (worked for `1.5.8+4`, GitHub
encodes it as `%2B` in URLs).

`auto-release.yml` runs daily: `update_versions.js` reads the newest
release tag of eclipse-mosquitto/mosquitto (plain `vX.Y.Z`, no release
candidates). Newer than the pinned one → set `<new>+0`, build all three architectures,
run the e2e test, commit, push, create the release (draft unless the
repository variable `AUTO_RELEASE_PUBLISH` is `true`), open an issue when
the run fails — the RedMatic task 10 pattern. Minor/major switches of
Mosquitto are **not** excluded here (unlike Node.js in RedMatic) since the
whole point is a package per Mosquitto release; a breaking Mosquitto major
(3.0 removes `password_file`/`acl_file`/`per_listener_settings`) needs a
look at the UI's config model first, so the script stops at a major
change and reports instead of releasing.

## 8. Hardware verification on the lab systems

On the three lab boxes (CCU3 firmware 3.89.8 armv7l, OpenCCU x86_64 VM,
OpenCCU aarch64 Pi 4 — addresses and credentials stay out of the repo):

- Manual install via `update_script` exactly as the firmware does it, the
  service through `rc.d`, syslog lines, settings page through lighttpd
  with a CCU session, pub/sub with the bundled clients, websockets, TLS
  with the CCU certificate and with a generated one, password file
  users, reload vs restart, log download, uninstall.
- **Migration test**: install the released 1.5.8+4 package on one box
  first, then update to the new package: `conf.d` folded, listeners kept,
  old libraries gone, broker up.
- WebUI install path (Zusatzsoftware upload) on the CCU3 (reboot,
  chroot install at shutdown) and OpenCCU (live).
- Self-update test with a local package server (`MOSQUITTO_UPDATE_BASE_URL`).
- Lab caveat: on the CCU3 lab box port 1883 is currently occupied by
  Node-RED's aedes broker from another session's test flow.

## 9. Documentation

- README (German like before, English section) rewritten: what the addon
  is, supported platforms (CCU3/armv7l, OpenCCU aarch64 and x86_64),
  install, firewall hint, the configuration UI, command-line
  configuration (`etc/mosquitto.conf`, `passwd`, `acl`, restart), the
  bundled client tools, version scheme, update.
- `docs/RELEASE_NOTES.md` for the first release: Mosquitto 2.1 instead
  of 1.5.8, the migration of `conf.d`, `allow_anonymous` semantics
  (Mosquitto 2.x defaults to `false` — the addon's default config keeps
  anonymous access on for compatibility with 1.5.8 installs, the UI
  shows it prominently), TLS 1.1 gone, websockets.
- `BUILD.md`: how to build locally (curl, tar, node for the resolver,
  patchelf), how to run the e2e test.

## 10. First release

`2.1.2+0` — after task 8 is green on all three boxes and the maintainer
has seen the result: **no push, tag or release before that** (maintainer's
instruction, 2026-09-05).

## 11. Bridge setup in the web UI

Maintainer's wish (2026-09-05). A **Bridges** card on the configuration
tab, one block per `connection`: name, `address` (host:port, several
allowed), remote username/password, remote client id, clean session,
protocol version (MQTT 3.1.1 / 5), `topic` lines (one per line, the
mosquitto syntax `pattern [direction [qos [local-prefix remote-prefix]]]`),
TLS to the remote broker (`bridge_cafile`, `bridge_insecure`),
notifications, `try_private`. The parser treats `connection` blocks like
listener blocks (managed keys + verbatim extras, `connection` ends a
listener block). Bridge changes need a restart. Covered by the parser unit
test; the e2e test bridges the container broker to itself on a second
listener and checks that a message crosses.

## 12. TLS listeners in the default configuration

Maintainer's wish (2026-09-05): a fresh install listens on 8883 (MQTT over
TLS) and 8884 (WebSockets over TLS) as well, with the CCU's own certificate
(`/etc/config/server.pem`) — like the 1.5.8 addon did. `update_script`
drops the two TLS blocks from the default when `server.pem` is missing
(the old addon renamed the fragments to `.disabled` in that case), so the
broker always starts. Firewall hint accordingly: `1883;1884;8883;8884`.

## 13. CCU firewall: show blocked ports, open them from the UI

Maintainer's wish (2026-09-05). Both firmwares configure the firewall
through `/lib/libfirewall.tcl` (`Firewall_loadConfiguration`,
`Firewall_MODE`, `Firewall_USER_PORTS`, `Firewall_saveConfiguration`,
`Firewall_configureFirewall`; the WebUI's `Firewall.setConfiguration` API
method does exactly that). `MOST_OPEN` = INPUT policy ACCEPT, every port
reachable; `RESTRICTIVE` = policy DROP, only the firmware services and the
user ports ("Port-Freigabe") pass — in both modes user ports go to the
local-only chain on current OpenCCU (LAN sources), which is what a broker
on the CCU wants. `www/firewall.cgi` (session required) reports mode and
user ports and, on `cmd=open`, adds the given listener ports to
`Firewall_USER_PORTS`, saves and applies — the same thing the CCU's own
firewall page does, so the entry shows up there too. The listener card
shows per port whether the firewall lets it through and offers one button
to open all listener ports. Verified against the real firewall pages of
both firmwares in task 8.
