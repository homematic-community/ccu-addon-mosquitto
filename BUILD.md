# Build Process

The addon version lives in `package.json` as `<mosquitto version>+<addon build>`
(e.g. `2.1.2+0`). Everything else is derived from it.

## Pipeline

`./build_addon.sh <armv7l|aarch64|x86_64>` builds one package:

1. `build_in_container.sh` runs in an Alpine container of the target
   architecture (`alpine:3.22`, `docker run --platform ...`; the ARM targets
   need qemu/binfmt: `docker run --privileged --rm tonistiigi/binfmt --install arm,arm64`),
   downloads the Mosquitto source tarball of the pinned version, compiles it
   with a minimal feature set and stages the binaries, the plugins and the
   musl/OpenSSL/cJSON libraries in `addon_tmp/out/stage`.
2. The host script copies the binaries and the transitive library closure
   into `addon_tmp/mosquitto/{bin,lib}` and rewrites the ELF interpreter and
   RPATH to `/usr/local/addons/mosquitto/lib` with `patchelf`, so the runtime
   is self-contained on every CCU.
3. `addon_files/` (scripts, CGIs, default config) are copied in, `versions`
   and `www/licenses.html` are generated, the tree is checked (every needed
   library present, interpreter inside the prefix) and packed into
   `dist/mosquitto[-<arch>]-<version>.tar.gz` plus a `.sha256` file.

`./build.sh` builds all three architectures and `RELEASE_BODY.md`
(`build_release_body.sh`).

Requires: docker (with binfmt for the ARM targets), node, tar, patchelf
(a static release binary from github.com/NixOS/patchelf works fine without root).

`VERSION_ADDON=2.1.2+99 ./build_addon.sh x86_64` builds a test package with
another version than package.json (e.g. one the self-update can update to).

## Tests

Node.js is a test tool only; nothing of it ships in the addon. `npm install`
once (the `mqtt` client for the tests), then:

- `npm run test:unit` — `node:test` unit tests of the mosquitto.conf parser in
  the settings page (`test/parser.test.js`).
- `npm run test:e2e` — `test/e2e.test.js`: end-to-end test of the built
  x86_64 package in a Debian container started by the test (needs docker):
  OpenCCU-style install and update, broker start, pub/sub with the mqtt
  client and the bundled tools, websockets, TLS, password file (refused
  anonymous and wrong passwords, add/change/delete on reload), bridge,
  persistence location, migration of a 1.5.8 `conf.d` layout, self-update
  worker, stop, uninstall. `KEEP=1` keeps the container afterwards.
- `npm run test:webui` — `test/webui.test.js`: the real settings page and its
  CGIs. The container additionally gets lighttpd with the firmware's CGI
  rules, a stub of `tclrega.so` (the session check), a stub of
  `/lib/libfirewall.tcl` and a fake `curl` for the GitHub lookups
  (`test/lib/webui-setup.js`). Section A calls every CGI with every command
  and error path over HTTP; section B drives the page with headless chromium
  (`npx playwright install chromium` once) and verifies each setting against
  the running broker: listeners, TLS certificate sources, users with
  write-only passwords, ACL, log types, persistence location incl. a
  bind-mounted "USB stick", firewall, bridges, the failed-start error
  display, the self-update through the page, tabs, an expired session.
  Section C measures the browser coverage of `www/js/script.js` and fails
  below 90 %. `KEEP=1` leaves the page at http://127.0.0.1:18080.

## Releases

- `.github/workflows/ci.yml` — on every push/PR: syntax checks, parser test,
  three-arch build (artifacts), e2e.
- `.github/workflows/build.yml` — release build. A pushed tag equal to the
  version in package.json (`git tag 2.1.2+2 && git push origin 2.1.2+2`)
  builds, tests and **publishes** the release for that tag; running it by hand
  creates a **draft prerelease** instead. A tag that does not match
  package.json fails the run before anything is built.
- `.github/workflows/auto-release.yml` — daily: `node update_versions.js`
  checks for a newer Mosquitto release; if there is one, the version becomes
  `<new>+0`, the packages are built and tested, the bump is committed and
  the release created (draft unless the repository variable
  `AUTO_RELEASE_PUBLISH` is `true`). A Mosquitto major release opens an issue
  instead.

Manual installation on a CCU over ssh, exactly what the firmware does:
copy the tarball to `/usr/local/tmp`, unpack it into a temp dir, run
`./update_script` from there (exit 10 = fresh install, 0 = update), then
`/usr/local/etc/config/rc.d/mosquitto start`.
