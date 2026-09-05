# Task 4 — Configuration web UI ✅

Completed 2026-09-05 (`www/`, `lib/`).

- Served by the CCU lighttpd from `/addons/mosquitto/`: tclsh CGIs with
  RedMatic's `check_session` (every read/write of the configuration and
  every service command needs a valid CCU session; `service.cgi?cmd=status`
  and `versions` are the only unauthenticated calls). No Bootstrap, jQuery
  or Font Awesome: one hand-written stylesheet (~5 KB) in the Bootstrap
  card look, vanilla JS (~35 KB), no build step.
- Configuration model in the browser (`js/script.js`, exported for
  `test/parser.test.js`): `etc/mosquitto.conf` is parsed into an ordered
  item list — passthrough lines, managed globals (`allow_anonymous`,
  `persistence`, `autosave_interval`, `connection_messages`, `log_type`,
  legacy `password_file`/`acl_file`), listener blocks, bridge blocks,
  plugin blocks — and written back in place. Unknown keys inside a block
  stay in the block, trailing comments belong to what follows, absent
  managed keys are only written when they differ from the Mosquitto
  default, plugin blocks of other plugins (dynsec) pass through.
- Cards: process (status, start/stop/restart/reload, last error when
  stopped), listeners (+ firewall status, task 13), bridges (task 11),
  certificate (CCU `server.pem`, self-signed generated on the CCU with
  hostname + IP SANs via `cert.cgi`, custom paths; `tls_version`),
  authentication (`allow_anonymous`, password-file plugin with user
  management through `passwd.cgi` → `mosquitto_passwd`, ACL toggle),
  logging, persistence. Debug tab: log download (`log.cgi`), versions.
  Licenses tab: the generated `licenses.html`.
- `setconfig.cgi` validates with `mosquitto --test-config` on a copy with
  `persistence false` appended (the test run would otherwise save an empty
  database over the live one), keeps `mosquitto.conf.bak`.
- Lessons: a literal brace inside a braced Tcl `if` breaks parsing
  (lighttpd 500), lighttpd's PATH has no `/sbin`, and the original CCU3
  firmware runs **Tcl 8.2.3** — no `2>@1`, `{*}`, `dict`, `eq`/`ne`,
  value-returning `regsub`/`scan` (`lib/querystring.tcl` has a `run`
  helper and a hand-written URL decoder; never `subst` user input).
