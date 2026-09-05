# Task 8 — Hardware verification on the lab systems ✅

Completed 2026-09-05 on the three lab boxes (addresses and credentials
stay out of the repo): original CCU3 firmware 3.89.8 on CCU3 hardware
(armv7l, Tcl 8.2.3), OpenCCU 3.89.8 ova (x86_64 VM), OpenCCU 3.89.8 on a
Raspberry Pi 4 (aarch64). All with the final `2.1.2+0` code.

## OpenCCU x86_64

- Manual install via `update_script` (exit 10), links, `hm_addons.cfg`
  entry, `rc.d` start, syslog lines, 1883/1884 listening, pub/sub with the
  bundled clients, `--test-config`.
- Every CGI through lighttpd with a real CCU session: settings page,
  session refusal, `getconfig`/`setconfig` round trip and validation error
  text, password set/delete (0600), certificate info and generation
  (hostname + IP SANs), update check (`1.5.8+4` = the current GitHub
  release, correctly not offered), update status, log download,
  start/stop/restart/reload.
- Headless chromium on the real page: version, status, listeners,
  certificate, log types, add a TLS listener, enable the password file,
  create a user, restart from the apply bar, change log types, revert,
  tabs — no console errors. Second run: bridges card (add, topics,
  remove), firewall status, provoked port clash → "stopped" with
  "Error: Address in use" on the page, heal, start.
- WebUI install path with the real `/bin/install_addon` (0.7 s), the
  self-update worker end to end through lighttpd (1 s).
- Firewall: switched to RESTRICTIVE via the CCU API → 1883 blocked from
  the LAN, `firewall.cgi?cmd=open` → user ports set, iptables rules
  present, CCU API reports the ports, 1883/8883 reachable; restored to
  MOST_OPEN.

## CCU3 firmware (armv7l)

- **Migration test with the real 1.5.8+4 release**: installed the old
  package (its own `update_script`), moved its listeners to 1885/1886
  (1883 is taken by another session's Node-RED broker on this box),
  old broker running with TLS 8883/8884. Update with the new package:
  `conf.d` folded incl. the TLS fragments, `allow_anonymous true` added,
  old libraries gone, `update_script` correctly does not start the
  service on this firmware (chroot install at shutdown), manual start,
  pub/sub on 1885 and TLS on 8883 with the CCU certificate.
- Found and fixed here: Tcl 8.2.3 (no `2>@1`, `{*}`, `dict`, `eq/ne`,
  value-returning `regsub`/`scan`) broke `service.cgi`, `passwd.cgi`,
  `setconfig.cgi`, `cert.cgi`, `log.cgi`, `update_addon` and the URL
  decoder. After the fixes every CGI and both headless page runs pass
  (Tcl 8.2 `firewall.cgi` included).

## OpenCCU aarch64 (Pi 4)

- Fresh install (exit 10, not started by `update_script` — the firmware
  reboots), start, pub/sub, websockets, later an update through
  `/bin/install_addon` with the fresh default config: four listeners,
  TLS round trip on 8883, headless page run incl. bridges, firewall and
  the port-clash error display — no console errors.

Not exercised: the CCU3 WebUI upload path itself (reboot + chroot
install at shutdown) — the same `update_script` ran by hand, and RedMatic
verified that firmware path with the identical mechanism.
