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

Status 2026-09-05: the modernization is **implemented and verified on all
three lab systems** (CCU3 firmware armv7l incl. the migration from the
real 1.5.8+4 release, OpenCCU x86_64, OpenCCU aarch64) — Mosquitto 2.1.2
built from source in Alpine containers, self-contained musl runtime,
configuration page with listeners, TLS certificate, authentication with
user management, bridges, CCU firewall status, logging, persistence
(also on a USB stick),
process control, self-update; CI, e2e and parser tests, automatic
releases. **`2.1.2+0` was released on 2026-09-05** (task 10); from now on
`auto-release.yml` publishes a new package for every Mosquitto release.

## Contents

- 1. Repository and tooling modernization ✅ [archived](roadmap-archive/task-1.md)
- 2. Build from source in Alpine containers for three architectures ✅ [archived](roadmap-archive/task-2.md)
- 3. Addon runtime: service script, installer, migration ✅ [archived](roadmap-archive/task-3.md)
- 4. Configuration web UI ✅ [archived](roadmap-archive/task-4.md)
- 5. Self-update from the settings page ✅ [archived](roadmap-archive/task-5.md)
- 6. Continuous integration and end-to-end test ✅ [archived](roadmap-archive/task-6.md)
- 7. Version scheme and automatic releases ✅ [archived](roadmap-archive/task-7.md)
- 8. Hardware verification on the lab systems ✅ [archived](roadmap-archive/task-8.md)
- 9. Documentation ✅ [archived](roadmap-archive/task-9.md)
- 10. First release ✅ [archived](roadmap-archive/task-10.md)
- 11. Bridge setup in the web UI ✅ [archived](roadmap-archive/task-11.md)
- 12. TLS listeners in the default configuration ✅ [archived](roadmap-archive/task-12.md)
- 13. CCU firewall: show blocked ports, open them from the UI ✅ [archived](roadmap-archive/task-13.md)
- [14. Follow-ups and ideas](#14-follow-ups-and-ideas)
- 15. Persistence on a USB stick, configurable in the UI ✅ [archived](roadmap-archive/task-15.md)
- 16. Tests in Node.js: unit, CGI integration, web UI end to end, coverage ✅ [archived](roadmap-archive/task-16.md)
- [17. Per-listener authentication](#17-per-listener-authentication)
- [Out of scope](#out-of-scope)

## 14. Follow-ups and ideas

Not planned, collected while working:

- **`--test-config` and persistence**: even with `--test-config` Mosquitto
  2.1.2 saves its (empty) in-memory database on exit. `setconfig.cgi`
  works around it (`persistence false` appended to the test copy); anyone
  running `mosquitto --test-config` by hand against the live config with
  the broker running should know. Worth an upstream report.
- The old 1.5.8 update check reads `VERSION` from master, which no longer
  exists: old installs will show "n/a" for the update; the README and
  release notes tell users to update through the Zusatzsoftware page.
- English UI strings (the page is German like RedMatic's).
- The self-update modal could show the release notes inline (the GitHub
  releases API has the body).

## 17. Per-listener authentication

Maintainer's wish (2026-09-05). Common setup: a loopback listener
(`127.0.0.1:1883`) for the CCU's own clients (Node-RED, hm2mqtt, …)
without authentication, and an external listener that requires
username/password. Today the "Anonyme Verbindungen" select is global and
the page writes one `allow_anonymous` for the whole broker.

- Mosquitto 2.1 has `listener_allow_anonymous [ true | false ]`: a
  listener-scoped override of the global `allow_anonymous`, no
  `per_listener_settings` needed (that one is deprecated and would also
  scope the password plugin per listener — not wanted). The 2.1.2 binary
  in the package knows the option (`strings` on the test box), the
  man page documents it under the listener options.
- UI: keep the global select as the default and add a per-listener
  choice on each listener card — "wie global / erlaubt / nicht erlaubt"
  — which maps to the absence or presence of `listener_allow_anonymous`
  in that listener block. The password plugin block stays global, so
  authenticated clients can still log in on a listener that also allows
  anonymous connections.
- Parser (`www/js/script.js`): `listener_allow_anonymous` becomes a
  managed listener key (`test/parser.test.js` cases for round trip,
  missing, and `per_listener_settings true` files from old installs —
  those should be left verbatim and shown with a hint, not rewritten).
- The auth warning ("no password file and no anonymous connections")
  has to be evaluated per listener; the firewall card is unaffected.
- Default config: unchanged (one listener, global setting). Document in
  the README's authentication section with the loopback/external example.
- Prior art: [she](https://github.com/hobbyquaker/she) models
  `allow_anonymous` per listener block in its `mosquitto-conf.js` and
  shows a card per listener — same shape as our listener cards.

## Out of scope

- **ACL editing in the UI** (was task 18, decided 2026-09-05). `acl_file`
  stays a path written by the page, the file itself is maintained on the
  command line (classic `topic`/`user`/`pattern` format, "Konfiguration
  neu laden" picks up changes). Anyone who needs topic ACLs has a setup
  sophisticated enough for [she](https://github.com/hobbyquaker/she),
  which manages users, roles and ACLs through the DynSec plugin live and
  without reload — a file-based ACL editor here would be a second,
  weaker way to do the same thing.
- **DynSec configuration UI.** The Dynamic Security plugin is bundled
  (`mosquitto_ctrl dynsec` works on the command line), but the addon
  will not get a UI for users/roles/groups. Anyone who wants that should
  look at [she](https://github.com/hobbyquaker/she)'s broker management:
  setup wizard that bootstraps DynSec on an existing broker, users,
  roles, ACLs and groups with immediate effect, listener and TLS
  configuration, certificate management, deployment to a remote broker
  over SSH — see `doc/broker-management.md` in that repository. The
  addon stays the small, self-contained broker with the basics
  (listeners, TLS, password file, bridges, persistence).

