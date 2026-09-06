# Task 19 — openccu-lite: run unchanged on a CCU without ReGaHSS ✅

Completed 2026-09-06, released as `2.1.2+2`.

[openccu-lite](https://github.com/hobbyquaker/openccu-lite) is a CCU firmware
without ReGaHSS and with systemd instead of busybox init. Its porting kit
(`docs/PORTING-PROMPT.md`, `docs/porting-from-rega.md`) asks addon maintainers
to audit their ReGa use, add a runtime-detected alternative where there is one,
and keep the CCU path byte for byte. The audit came out short.

## Audit: where the addon touches the ReGa

- **`lib/session.tcl`** — `load tclrega.so` and
  `rega_script "Write(system.GetSessionVarStr('$sidnr'));"`. This is the one
  call openccu-lite's `tclrega.so` shim answers, and the porting prompt's
  invariant 6 says to leave it exactly as it is. **Unchanged.**
- Nothing else. No `dom.GetObject`, no `/api/homematic.cgi`, no `:8181`, no
  HM-Script, no ReGa ids, no system variables or programs — the addon is a
  broker and reads no device names, rooms or functions. The metadata API of
  the porting prompt has nothing to provide it, so there is no second provider
  to build.
- `hm_addons.cfg` (`bin/update_addon`), the rc.d `info` keys and
  `/usr/local/etc/config/addons/www/` are addon ABI, not ReGa; openccu-lite
  parses all three (`internal/system/services.go`, `ParseHMAddonsCfg`,
  `parseInfo`) and the `info` output of this addon is literally the fixture in
  its `system_test.go`. **Unchanged.**
- `/lib/libfirewall.tcl` (`www/firewall.cgi`) is firmware, not ReGa, and
  openccu-lite keeps it — the port release matters *more* there, because its
  firewall default is `RESTRICTIVE` where the CCU ships `MOST_OPEN`. The CGI
  already degrades to `{"available":false}` and the page hides the card.
- Verified against openccu-lite's own detector (`internal/system/regadeps.go`,
  which disables addons whose code carries ReGa idioms): a replica of the scan
  over the built package's tree reports **not ReGa-dependent**, so the addon
  stays enabled after an update from OpenCCU.

## What changed

- **`bin/mosquitto-service`, pid file.** openccu-lite can run an addon as its
  own user (`addon-mosquitto`, its D-36). `/var/run` then belongs to root and
  `start-stop-daemon` cannot create `mosquitto.pid` in it — the start failed
  with `unable to open pidfile … (Permission denied)`. The pid file now moves
  to `var/mosquitto.pid` inside the addon **only when the script does not run
  as root**; on a CCU (and on openccu-lite in its default root mode) it stays
  at `/var/run/mosquitto.pid`. `Pid()` already falls back to scanning `/proc`
  for the daemon, so a root-run CGI and an addon-user-run daemon still find
  each other.
- **`bin/mosquitto-service`, last error.** `Status()` reads the last broker
  error out of `/var/log/messages` for the process card. A systemd box logs to
  the journal and has no such file, so a failed start had an empty reason.
  When — and only when — `/var/log/messages` does not exist, the same line now
  comes from `journalctl -t mosquitto`.
- **`www/log.cgi`.** Same idea for the debug download: without
  `/var/log/messages`, two journal sections (`-t mosquitto` and
  `-u addon-mosquitto.service`) instead of the syslog section.
- **`update_script`.** Creates `/usr/local/etc/config/addons/mosquitto/`.
  Nothing on a CCU uses it, but openccu-lite lists it in the confined unit's
  `ReadWritePaths=` and systemd refuses to start a unit whose `ReadWritePaths`
  entry is missing (`226/NAMESPACE`) — without the directory the addon does not
  start at all in confined mode. `uninstall` removes it with `rmdir`, so
  anything a user put there survives.
- **Package names.** Every architecture is now published as
  `mosquitto-<arch>-<version>.tar.gz` — what addon catalogues resolve
  (`uname -m`). armv7l is additionally published under its historical name
  `mosquitto-<version>.tar.gz`, the same bytes with a second `.sha256`: the
  catalogue's universal fallback and the link in every forum post. The
  self-update asks for the architecture name first and falls back to the old
  one, so it also updates *from* a release that only has the old name.
- **`.github/workflows/build.yml`.** A pushed tag matching the version now
  builds and publishes the release; a manual run still produces the draft
  prerelease. The tag has to equal `package.json`'s version or the run fails
  before building.
- **README**: an `openccu-lite` section — what is identical, the journal, the
  firewall default, the generated unit, what a confined addon user can and
  cannot do (no firewall release, no self-update, `server.pem` must be
  readable), a table of every path the addon touches outside its own
  directory, and the `runtime` block for the catalogue entry.

## Verified

On this machine, not claimed: all three packages built (`armv7l`, `aarch64`,
`x86_64`, the armv7l one under both names with matching checksums), and the
x86_64 package installed through `update_script` into a **privileged Debian
container running systemd as pid 1**, driven by the unit openccu-lite's
`occu-addons` generator writes (`Type=oneshot`, `RemainAfterExit=yes`,
`ExecStart=… start`, `ExecStop=… stop`, `KillMode=control-group`):

- `systemctl start` returns in 11 ms (start-stop-daemon backgrounds the
  broker), the unit is `active (exited)` and the broker sits in the unit's own
  cgroup — `systemctl stop` (511 ms), `restart`, `reload` and the rc.d
  `status` JSON all behave;
- a deliberately broken configuration (missing certificate) produces
  `{"running":false,"lastError":"OpenSSL Error [2]: …"}` **out of the journal**,
  which is what the fix is for;
- confined mode with the `10-policy.conf` drop-in `renderDropIn()` produces:
  first reproduced both failures above, then, with the two fixes, the broker
  runs as `addon-mosquitto` with all four listeners bound, `mosquitto_passwd`
  works, `status` agrees whether root or the addon user asks, and stop leaves
  nothing behind. Mosquitto prints no complaint about `user root` when it does
  not start as root;
- root mode after removing the drop-in: pid file back at
  `/var/run/mosquitto.pid`, broker as root — the CCU path is untouched.

Not verified here (no box): the `tclrega.so` shim itself, and the addon under
the real openccu-lite image. The web UI suite covers the session check against
a compiled stub of the firmware's `tclrega.so`, which is the same contract.
