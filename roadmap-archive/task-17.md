# Task 17 — Per-listener authentication ✅

Maintainer's wish, completed 2026-09-05, released as `2.1.2+1`.

The common setup: a loopback listener (`listener 1883 127.0.0.1`) for the
CCU's own clients (Node-RED, hm2mqtt, …) without login, an external
listener that requires username/password.

- Mosquitto 2.1's `listener_allow_anonymous [ true | false ]` is a
  listener-scoped override of the global `allow_anonymous`; no
  `per_listener_settings` (deprecated, and it would scope the password
  plugin per listener as well). The 2.1.2 binary in the package knows the
  option (`strings` on the test box), the man page lists it under the
  listener options.
- UI: each listener card has a select "Anonym" — *global: erlaubt /
  nicht erlaubt*, *erlaubt*, *nicht erlaubt (Login)* —
  mapped to the absence or presence of `listener_allow_anonymous` in
  the block. The global select on the "Authentifizierung" card stays the
  default and got a help line pointing at the per-listener override.
- The warning "without a password file …" is evaluated per listener:
  all listeners closed → the old sentence, some → "auf Port 1883, 8883
  kein Client".
- Old files with `per_listener_settings true` are left as they are (the
  page has always managed `allow_anonymous` globally, the first
  occurrence wins) and get an info box suggesting to drop the line and
  use the per-listener select instead.
- Parser: `listener_allow_anonymous` is a managed listener key written
  after `max_connections`; unit tests for parse/override/round trip,
  write/remove/new listener, and the deprecated flag. Web UI test: 1883
  refuses anonymous clients while WebSockets and TLS still take them,
  then global off with the WebSockets listener as the exception; the
  broker is checked per port after each restart. The hand-written-file
  test carries `per_listener_settings true` and checks the hint.
- Default configuration unchanged (comment mentions the option); README
  documents the case in the listener and authentication bullets.
- Prior art: [she](https://github.com/hobbyquaker/she) models
  `allow_anonymous` per listener block in its `mosquitto-conf.js` and
  shows a card per listener.
