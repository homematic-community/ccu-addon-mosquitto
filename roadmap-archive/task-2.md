# Task 2 — Build from source in Alpine containers for three architectures ✅

Completed 2026-09-05 (`build_addon.sh`, `build_in_container.sh`,
`build_licenses.js`, `build.sh`).

- `build_addon.sh <armv7l|aarch64|x86_64>` runs `build_in_container.sh`
  in an `alpine:3.22` container of the target architecture (docker with
  qemu/binfmt for ARM), which compiles the official Mosquitto tarball
  (GitHub tag archive as fallback) with a minimal feature set: TLS (+PSK),
  built-in websockets, bridges, persistence, `$CONTROL`, unix sockets;
  off: HTTP API, sqlite, editline, SRV/c-ares, SOCKS, systemd, docs.
- Shipped: `bin/mosquitto`, `mosquitto_sub`, `mosquitto_pub`,
  `mosquitto_ctrl`, `mosquitto_passwd`; plugins `mosquitto_password_file.so`,
  `mosquitto_acl_file.so`, `mosquitto_dynamic_security.so` (maintainer's
  wish). Libraries from the closure: musl loader/libc, libssl3, libcrypto3,
  libcjson, libmosquitto. Interpreter and RPATH patched to
  `/usr/local/addons/mosquitto/lib` (plus `$ORIGIN`), plugins get an RPATH
  too; self-check that every DT_NEEDED is in the tree.
- Result: 7.7 MB unpacked, 3.3 MB compressed per architecture.
- Rejected first attempt: Alpine's own `mosquitto` package. It links
  libmicrohttpd (HTTP API) → gnutls, nettle, gmp, p11-kit, libidn2,
  libtasn1, libunistring, libffi, brotli, zstd, plus sqlite, libwebsockets,
  libedit/ncurses: 17 MB / 7.4 MB for features the addon does not use.
- `versions` (VERSION_ADDON, MOSQUITTO_VERSION, ADDON_ARCH, ALPINE_VERSION,
  PKG_* of the bundled libraries), `www/licenses.html` from apk's
  installed db (name, version, SPDX license, upstream URL), `.sha256`
  siblings with the bare file name. Package names as before:
  `mosquitto-<version>.tar.gz` (armv7l), `mosquitto-<arch>-<version>.tar.gz`.
- Gotchas: busybox `install` has no `--strip-program` (strip afterwards),
  the top-level `make install` wants the sqlite plugin (install per
  directory), `apk info -v` prints several lines.
