# Task 12 — TLS listeners in the default configuration ✅

Maintainer's wish, completed 2026-09-05.

- `etc/mosquitto.conf.default` listens on 8883 (MQTT over TLS) and 8884
  (WebSockets over TLS) with `/etc/config/server.pem` as `certfile` and
  `keyfile`, like the 1.5.8 addon did — next to 1883 and 1884.
- `update_script` writes the default without the two TLS blocks when
  there is no CCU certificate (debmatic, containers), so the broker always
  starts; the e2e container creates a CCU-style `server.pem` and checks
  the TLS round trip on 8883 and the websocket upgrade over TLS on 8884.
- The parser test round-trips the shipped default byte-identically; the
  certificate card shows "CCU-Zertifikat" for a fresh install. Verified
  on all three lab boxes (four listeners, TLS round trip with the CCU
  certificate on the Pi 4 and the CCU3).
