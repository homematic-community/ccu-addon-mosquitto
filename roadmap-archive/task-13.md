# Task 13 — CCU firewall: show blocked ports, open them from the UI ✅

Maintainer's wish, completed 2026-09-05.

- Research: both firmwares configure the firewall through
  `/lib/libfirewall.tcl` (`Firewall_loadConfiguration`, `Firewall_MODE`,
  `Firewall_USER_PORTS`, `Firewall_saveConfiguration`,
  `Firewall_configureFirewall`); the WebUI's `Firewall.setConfiguration`
  API method (`/www/api/methods/firewall/`) does nothing else.
  `MOST_OPEN` = INPUT policy ACCEPT, every port reachable; `RESTRICTIVE`
  = policy DROP, only firmware services and the user ports
  ("Port-Freigabe") pass. On current OpenCCU user ports go to the
  local-only chain (LAN sources), which is right for a broker on the CCU.
  `/etc/config/firewall.conf` gets a `USERPORTS = ...` line.
- `www/firewall.cgi` (session required, Tcl 8.2 compatible):
  `cmd=status` → mode and user ports; `cmd=open` with `ports=...` adds
  the listener ports to `Firewall_USER_PORTS`, saves and applies. The
  listener card shows "Firewall: offen/gesperrt" per port, a sentence
  about the mode and one button that opens all blocked listener ports.
- Verified on OpenCCU x86_64: RESTRICTIVE via the CCU API → 1883 blocked
  from the LAN → `cmd=open` → iptables rules for 1883/1884/8883/8884,
  ports reachable, the CCU's own API lists them; restored to MOST_OPEN.
  Status shown correctly on all three boxes (all MOST_OPEN in the lab).
- Deliberately stateless: no persisted "auto-open" checkbox; the page
  re-evaluates on every load and after every listener change.
