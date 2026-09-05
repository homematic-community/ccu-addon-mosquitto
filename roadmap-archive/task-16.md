# Task 16 — Tests in Node.js: unit, CGI integration, web UI end to end, coverage ✅

Maintainer's wishes (2026-09-05): port the shell e2e test to Node.js (tests only, Node.js never
becomes part of the addon), extensive tests of every path of the web UI (unit, integration, e2e,
near 100 % coverage), every Mosquitto aspect configurable through the UI verified against the
running broker, including the password file (create user, reload, wrong and right password).
Completed 2026-09-05.

- `test/parser.test.js` (node:test, 18 cases): the mosquitto.conf model of the page.
- `test/e2e.test.js` (14 cases, 33 s): the container is started by the test, OpenCCU's installer
  replayed through `docker exec`, the broker checked with the `mqtt` client through published
  ports. Wrong password and unknown user refused, password change and deletion on reload, TLS and
  websockets with authentication, bridge, persistence location, migration, self-update, uninstall.
- `test/webui.test.js` (24 cases, about 2.5 minutes): the real settings page and CGIs served by
  lighttpd inside the container with the firmware's CGI rules, a compiled stub of `tclrega.so`
  (session check), a stub of `/lib/libfirewall.tcl` and a fake `curl` for the GitHub lookups.
  Section A calls every CGI with every command and error path; section B drives the page with
  headless chromium (playwright) and verifies each setting against the broker: listeners (add,
  bind, protocol, TLS, max_connections, remove), certificate sources (CCU, generated, custom),
  users with write-only passwords (umlauts and quotes included), ACL enforcement, log types and
  connection messages in the syslog, persistence location with a bind-mounted stick and an
  unplugged one, firewall in RESTRICTIVE mode, bridges carrying messages, the failed-start error
  display, the self-update through the page (success and failure), tabs, an expired session,
  hand-written extra options, a failing CGI. Section C measures the browser coverage of
  `www/js/script.js` (snapshots around reloads, merged) and fails below 90 %: 94 % before the
  last test was added, the rest are `catch` handlers for a dead backend.
- `test/lib/`: container, page and web-setup helpers; the stubs as plain files.
- CI installs the mqtt client and chromium and runs all three suites; the release workflows run
  e2e and web UI before a release.
- Found by these tests and fixed in the addon: a non-ASCII password was re-encoded by Tcl before
  reaching `mosquitto_passwd` (request bytes now pass through unchanged); choosing "custom"
  certificate paths flipped back to the derived source after each save; a plugin enabled before
  its password/ACL file exists stopped the broker from starting (the service creates the file).
- Lessons for the container: pid 1 must reap (`--init`), `ldconfig` ignores names without a
  `lib` prefix, lighttpd needs the init PATH with `/sbin`, `/media` is a tmpfs on the CCU,
  Chromium's coverage only knows live scripts.
