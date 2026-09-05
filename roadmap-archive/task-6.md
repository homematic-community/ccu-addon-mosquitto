# Task 6 — Continuous integration and end-to-end test ✅

Completed 2026-09-05 (`.github/workflows/ci.yml`, `build.yml`,
`test/e2e.sh`, `test/e2e-inner.sh`, `test/parser.test.js`).

- `ci.yml`: shell syntax (`bash -n`, `sh -n`), shellcheck at error level,
  `node --check`, the parser unit test, a three-architecture build matrix
  (docker + `docker/setup-qemu-action` for ARM, patchelf) with artifacts,
  and the e2e job on the x86_64 artifact.
- `test/e2e.sh` (Debian bookworm container, busybox `sh` and `syslogd`,
  tcl for the CGI-style `update_addon`, a CCU-style `server.pem`): fresh
  install → exit 10, links and button, start, `cd /`, pub/sub with the
  bundled clients, websockets upgrade on 1884, the TLS listeners of the
  default config (8883 round trip, 8884 websockets over TLS), password
  plugin (anonymous refused, user accepted, TLS + auth), password change +
  reload without restart, bridge (the broker bridges itself over a second
  listener, message crosses `local/` → `remote/`), update with the same
  package → exit 0 + restart + config/passwd preserved, migration of a
  1.5.8 `conf.d` layout (folded, `.disabled` TLS fragment works,
  anonymous stays allowed, old libraries gone), self-update worker
  against `busybox httpd`, stop, uninstall (dir, links, button gone).
- `test/parser.test.js`: 17 cases for the mosquitto.conf model (round
  trip of the shipped default byte-identical, TLS listeners, cert source,
  block removal, unknown sub-keys, plugin blocks, legacy directives,
  dynsec passthrough, log types, duplicates, migrated files, CRLF,
  bridges).
- `build.yml`: manual release build → draft prerelease tagged `<version>`
  (no `v`, like the old releases) with the three tarballs, `.sha256` files
  and `RELEASE_BODY.md`.
- Not run on GitHub yet (nothing pushed — maintainer's instruction);
  everything ran locally in WSL with docker.
