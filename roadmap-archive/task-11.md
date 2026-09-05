# Task 11 — Bridge setup in the web UI ✅

Maintainer's wish, completed 2026-09-05.

- A **Bridges** card on the configuration tab, one block per
  `connection`: name, `address` (several host:port allowed), remote
  username/password/client id, clean session, protocol version (default /
  MQTT 5 / 3.1.1 / 3.1), status notifications, `try_private`, TLS to the
  remote broker (`bridge_cafile`, `bridge_insecure`), `topic` lines (one
  per line in the mosquitto syntax). Unknown keys inside a block (e.g.
  `restart_timeout`) stay in the block and are listed.
- Parser: `connection` starts a bridge block and ends a listener block;
  a global key ends it. Round trip is byte-identical (unit tests), the
  e2e test bridges the container broker to itself over a second listener
  and checks that a message crosses with the `local/` → `remote/`
  prefixes; verified in the browser on all three lab boxes (add, topics
  written, remove).
- `remote_password` is stored in plain text in `mosquitto.conf`, as
  Mosquitto requires; the field is a password input.
