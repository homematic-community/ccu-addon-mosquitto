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
- ACL file editing in the UI (currently command line only), per-listener
  authentication (`per_listener_settings` is deprecated in 2.1, the
  listener-specific replacements arrive with 2.1/3.0), DynSec management
  (`mosquitto_ctrl dynsec` works on the command line, the plugin is
  bundled).
- English UI strings (the page is German like RedMatic's).
- The self-update modal could show the release notes inline (the GitHub
  releases API has the body).
