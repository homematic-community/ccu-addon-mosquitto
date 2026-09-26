# ccu-addon-mosquitto

[![Current Release](https://img.shields.io/github/release/homematic-community/ccu-addon-mosquitto.svg?colorB=4cc61e)](https://github.com/homematic-community/ccu-addon-mosquitto/releases/latest)
[![Github Releases](https://img.shields.io/github/downloads/homematic-community/ccu-addon-mosquitto/total.svg)](https://github.com/homematic-community/ccu-addon-mosquitto/releases)
[![ci](https://github.com/homematic-community/ccu-addon-mosquitto/actions/workflows/ci.yml/badge.svg)](https://github.com/homematic-community/ccu-addon-mosquitto/actions/workflows/ci.yml)

Der MQTT-Broker [Mosquitto](https://mosquitto.org/) als Addon für die
[Homematic CCU3](https://www.homematic-ip.com/produkte/detail/smart-home-zentrale-ccu3.html) und
[OpenCCU](https://github.com/jens-maus/OpenCCU) (ehemals RaspberryMatic).

<sub>[🇬🇧 English summary below](#english)</sub>

* Aktuelles Mosquitto (2.1.x) mit TLS, WebSockets, Persistenz, Passwortdatei, ACL-Datei und dem
  Dynamic-Security-Plugin, dazu die Kommandozeilenwerkzeuge `mosquitto_sub`, `mosquitto_pub`,
  `mosquitto_ctrl` und `mosquitto_passwd`.
* Konfigurationsseite in der CCU-Oberfläche: Listener, Zertifikat, Authentifizierung mit
  Benutzerverwaltung, Logging, Persistenz, Prozesssteuerung, Log-Download und Update per Klick.
* Läuft auf der CCU3 (armv7l), auf OpenCCU in den 64-bit-ARM- (aarch64) und x86_64-Varianten und
  auf [openccu-lite](#openccu-lite); die Binaries bringen ihre Laufzeitumgebung (musl, OpenSSL 3)
  selbst mit.
* Für jede Mosquitto-Version erscheint automatisch ein Release, siehe [Versionen](#versionen).

## Installation

1. Das passende Paket von der [Release-Seite](https://github.com/homematic-community/ccu-addon-mosquitto/releases/latest)
   laden:

   | Paket | Zentrale |
   | --- | --- |
   | `mosquitto-armv7l-<version>.tar.gz` (= `mosquitto-<version>.tar.gz`) | CCU3 (Original-Firmware), piVCCU3, OpenCCU _rpi2_, _tinkerboard_, _oci_arm_ (armv7l) |
   | `mosquitto-aarch64-<version>.tar.gz` | OpenCCU _rpi3_, _rpi4_, _rpi5_, _oci_arm64_ (aarch64) |
   | `mosquitto-x86_64-<version>.tar.gz` | OpenCCU _ova_, _intelnuc_, _oci_amd64_ (x86_64) |

   Das armv7l-Paket liegt seit `2.1.2+2` unter beiden Namen bei – dieselbe Datei: der Name mit
   Architektur ist der einheitliche (und der, den Addon-Kataloge auflösen), der ohne der seit den
   1.5.8-Releases gewohnte. Der Dateiname entscheidet nichts, das Paket prüft beim Installieren
   selbst, ob es zur Architektur passt.

2. In der CCU unter _Einstellungen > Systemsteuerung > Zusatzsoftware_ hochladen und installieren.
   Die Original-Firmware der CCU3 startet dazu neu, OpenCCU installiert direkt.
3. **CCU3:** die Ports in der Firewall freigeben (_Einstellungen > Systemsteuerung > Firewall
   konfigurieren > Port-Freigabe_), z. B. `1883;1884` – bei TLS zusätzlich `8883;8884`.

Danach läuft der Broker mit der Standardkonfiguration: MQTT auf Port 1883, WebSockets auf 1884,
beides zusätzlich über TLS auf 8883 und 8884 mit dem Zertifikat der CCU, anonyme Verbindungen
erlaubt, Persistenz eingeschaltet, Log ins Syslog (`/var/log/messages`). Die Konfigurationsseite
zeigt, ob die CCU-Firewall die Listener-Ports durchlässt, und kann sie mit einem Klick freigeben.

Beim Update von einer alten Version (1.5.8+x) werden die Konfigurationsschnipsel aus `etc/conf.d/`
in die eine `etc/mosquitto.conf` übernommen (das alte Verzeichnis bleibt als `conf.d.old` liegen).

## Konfiguration

Unter _Einstellungen > Systemsteuerung > Zusatzsoftware > Mosquitto_ (Schaltfläche _Einstellungen_):

* **Prozess** – Status, Start, Stop, Neustart, Konfiguration neu laden (SIGHUP).
* **Listener** – Port, Bind-Adresse, MQTT oder WebSockets, TLS ein/aus, maximale Verbindungen,
  anonyme Verbindungen je Listener (übersteuert die globale Einstellung); Listener hinzufügen und
  entfernen. Zu jedem Port steht, ob die CCU-Firewall ihn durchlässt;
  gesperrte Ports werden mit einer Schaltfläche in die Port-Freigabe der Firewall eingetragen.
* **Bridges** – Verbindungen zu anderen Brokern: Adresse(n), Login, Client-ID, Clean Session,
  Protokollversion, TLS (CA-Datei), Status-Nachrichten, `try_private` und die `topic`-Zeilen.
* **Zertifikat** für die TLS-Listener: das Zertifikat der CCU (`/etc/config/server.pem`), ein auf
  der CCU erzeugtes selbstsigniertes Zertifikat (`etc/certs/`) oder eigene Dateien; minimale
  TLS-Version.
* **Authentifizierung** – anonyme Verbindungen erlauben oder nicht (global, je Listener
  übersteuerbar – der übliche Fall: ein Listener `1883` auf `127.0.0.1` ohne Login für die Clients
  auf der CCU selbst, der Listener nach außen mit Login), Passwortdatei mit Benutzerverwaltung
  (`etc/passwd`, Plugin `mosquitto_password_file`), ACL-Datei ein/aus (`etc/acl`, wird auf der
  Kommandozeile gepflegt).
* **Logging** – Log-Typen, Verbindungsmeldungen.
* **Persistenz** – ein/aus, Speicherort (Addon-Verzeichnis, ein von der CCU eingehängter
  USB-Stick unter `/media/usb…` zur Schonung der SD-Karte, oder ein eigener Pfad; die Seite
  zeigt, ob der Ort eingehängt und beschreibbar ist), Speicherintervall.
* **Debug** – Log-Download (Versionen, Konfiguration, Speicher, Sockets, Firewall, Syslog).

Nach Änderungen zeigt die Seite eine Schaltfläche für den nötigen Neustart. Änderungen an Passwort-
und ACL-Datei übernimmt Mosquitto mit _Konfiguration neu laden_, alles andere braucht einen Neustart.

### Kommandozeile

Die Seite verwaltet `/usr/local/addons/mosquitto/etc/mosquitto.conf` und lässt Zeilen, die sie
nicht kennt, unverändert – die Datei kann also auch per Hand gepflegt werden
([Dokumentation](https://mosquitto.org/man/mosquitto-conf-5.html)). Ein Client-Zertifikat-Zwang
(mTLS), Bridges oder das Dynamic-Security-Plugin (`plugin
/usr/local/addons/mosquitto/lib/mosquitto_dynamic_security.so`) werden so eingerichtet.

```
/usr/local/etc/config/rc.d/mosquitto start|stop|restart|reload|status
/usr/local/addons/mosquitto/bin/mosquitto_sub -t '#' -v
/usr/local/addons/mosquitto/bin/mosquitto_pub -t test -m hello
/usr/local/addons/mosquitto/bin/mosquitto_passwd -b /usr/local/addons/mosquitto/etc/passwd user passwort
/usr/local/addons/mosquitto/bin/mosquitto_ctrl dynsec ...
```

Die Ausgaben landen im Syslog (`/var/log/messages`, Tag `mosquitto`). Die Persistenz-Datenbank
liegt in `var/`. Ein CCU-Backup enthält `etc/` und `var/`, nicht die Binaries.

> **Nicht geplant:** eine Oberfläche für die ACL-Datei oder das Dynamic-Security-Plugin. Wer
> Benutzer, Rollen und Topic-Rechte komfortabel verwalten möchte, findet das im Broker-Management
> von [she](https://github.com/hobbyquaker/she) (Dynsec-Benutzer, Rollen und ACLs live ohne
> Neustart, Listener, TLS und Zertifikate, auch für einen Broker auf einem anderen Host). Das Addon
> bleibt der kleine Broker mit den Grundfunktionen.

> **Hinweis zu Mosquitto 2.x:** Ohne `allow_anonymous true` und ohne Passwortdatei nimmt der
> Broker keine Verbindungen an (bei 1.5.8 waren anonyme Verbindungen der Standard). Das Addon
> setzt `allow_anonymous true` in der Standardkonfiguration und beim Update von 1.5.8.

## Update

Steht eine neue Version bereit, zeigt die Konfigurationsseite eine Schaltfläche _Herunterladen und
installieren_: das Paket wird von GitHub geladen, die Prüfsumme geprüft und wie über die
Zusatzsoftware-Seite installiert; Konfiguration und Persistenz bleiben erhalten. Alternativ das
neue Paket manuell über die Zusatzsoftware-Seite hochladen.

## openccu-lite

[openccu-lite](https://github.com/hobbyquaker/openccu-lite) ist eine CCU-Firmware ohne ReGaHSS
(kein `rega.exe`, keine Systemvariablen, keine Programme, kein HM-Script) mit systemd statt
busybox-init. Das Addon läuft dort **unverändert** – dasselbe Paket wie auf CCU3 und OpenCCU, keine
eigene Variante, keine zusätzliche Konfiguration.

Das Addon spricht mit der ReGa an genau einer Stelle: der Sitzungsprüfung der Konfigurationsseite
(`rega_script "Write(system.GetSessionVarStr('…'))"` in `lib/session.tcl`). Genau diesen Aufruf
beantwortet openccu-lite mit seinem `tclrega.so`-Shim, deshalb funktionieren Anmeldung und alle
CGIs wie gewohnt. Broker, Listener, TLS, Authentifizierung, Bridges, Persistenz, Prozesssteuerung,
Firewall-Freigabe und das Update per Klick brauchen die ReGa nicht und verhalten sich identisch.

Unterschiede, die man kennen sollte:

* **Installation:** aus dem Addon-Katalog des Systems (_Zusatzsoftware → Katalog_), dasselbe Paket
  wie auf der CCU; seine Beschreibung für openccu-lite (`openccu-lite.json`) liegt im Paket.
* **Start:** der Broker braucht keinen Schnittstellenprozess (`"needs": []`) und startet deshalb
  gleich nach dem Netzwerk, vor `rfd` und `hmipserver`. Clients wie hm2mqtt oder RedMatic finden
  ihn beim eigenen Start schon vor.
* **Log:** openccu-lite protokolliert in den systemd-Journal, ein `/var/log/messages` gibt es nicht.
  `log_dest syslog` bleibt richtig – die Zeilen landen über `/dev/log` im Journal und sind mit
  `journalctl -t mosquitto` bzw. `journalctl -u addon-mosquitto` zu sehen. Die Prozesskarte holt die
  letzte Fehlermeldung eines fehlgeschlagenen Starts dann aus dem Journal, und der Log-Download im
  Debug-Tab hängt Journal-Auszüge an Stelle des Syslogs an.
* **Firewall:** die Voreinstellung ist `RESTRICTIVE` (die CCU liefert `MOST_OPEN` aus), die
  Listener-Ports sind von außen also zunächst gesperrt. Die Schaltfläche auf der Listener-Karte
  trägt sie über dieselbe `libfirewall.tcl` in die Port-Freigabe ein wie auf der CCU.
* **Dienst:** die rc.d-Datei wird von einer generierten systemd-Unit `addon-mosquitto.service`
  aufgerufen (`Type=oneshot`, `RemainAfterExit=yes`, `ExecStart=… start`, `ExecStop=… stop`,
  `KillMode=control-group`). `systemctl start|stop|restart addon-mosquitto` und
  `/usr/local/etc/config/rc.d/mosquitto start|stop|…` funktionieren beide.
* **Eigener Benutzer (optional):** openccu-lite kann ein Addon eingeschränkt als `addon-mosquitto`
  statt als root laufen lassen. Der Broker funktioniert dabei vollständig – die Standard-Ports
  liegen alle über 1024, `user root` in der `mosquitto.conf` ist wirkungslos, wenn der Prozess
  nicht als root startet, und die PID-Datei wandert automatisch von `/var/run/mosquitto.pid` nach
  `var/mosquitto.pid` im Addon-Verzeichnis. **Nicht** funktionieren in diesem Modus die Aktionen,
  die Root-Rechte brauchen: die Firewall-Freigabe (`/etc/config/firewall.conf` und iptables) und
  das Selbst-Update (der Firmware-Installer). Wer beides nutzen möchte, lässt das Addon im Modus
  „root“ laufen – das ist die Voreinstellung. Außerdem muss `/etc/config/server.pem` für den
  Addon-Benutzer lesbar sein, sonst starten die TLS-Listener nicht; alternativ unter _Zertifikat_
  ein eigenes erzeugen (`etc/certs/` gehört dem Addon).

### Was das Addon außerhalb seines eigenen Verzeichnisses anfasst

`/usr/local/addons/mosquitto/` gehört dem Addon; alles andere in dieser Liste ist für ein
Confinement-Profil relevant:

| Pfad | wann | wer |
| --- | --- | --- |
| `/usr/local/etc/config/rc.d/mosquitto`, `…/addons/www/mosquitto` | Installation (Symlinks) | Installer (root) |
| `/usr/local/etc/config/hm_addons.cfg` | Installation (Konfigurations-Schaltfläche) | Installer (root) |
| `/usr/local/etc/config/addons/mosquitto/` | Installation (leeres Verzeichnis) | Installer (root) |
| `/var/run/mosquitto.pid` | Start als root; sonst `var/mosquitto.pid` im Addon | Dienst |
| `/tmp/mosquitto-update/` | Selbst-Update (Status, Log, Worker-Kopie) | Update-Worker |
| `/usr/local/tmp/new_addon.tar.gz`, `/usr/local/tmp/tmp.*` | Selbst-Update (Download, Installer) | Update-Worker |
| Syslog bzw. Journal (`logger -t mosquitto`) | laufend | Dienst |
| `/etc/config/firewall.conf` + iptables | nur bei _Ports freigeben_ | `firewall.cgi` (root) |
| `/media/usb…/` | nur wenn die Persistenz dorthin gelegt wird | Broker |

`/etc/config/server.pem` wird nur gelesen. Ein passender `runtime`-Block für den Addon-Katalog von
openccu-lite ist damit:

```json
"runtime": { "root": true, "ports": [1883, 1884, 8883, 8884] }
```

`root: false` ist möglich (siehe oben: ohne Firewall-Freigabe und ohne Selbst-Update) und braucht
keine zusätzlichen Capabilities, aber `paths` für `/etc/config/server.pem`, wenn die TLS-Listener
das Zertifikat der Zentrale verwenden sollen.

> Das Addon ist ein Broker, keine CCU-Anbindung: es liest weder Gerätenamen noch Räume, Gewerke,
> Systemvariablen oder Programme. Auf openccu-lite gibt es Systemvariablen und Programme
> ohnehin nicht – wer CCU-Datenpunkte auf MQTT braucht, nimmt zusätzlich
> [hm2mqtt](https://github.com/hobbyquaker/hm2mqtt.js) oder
> [CCU-Jack](https://github.com/mdzio/ccu-jack).

## Versionen

Die Addon-Version ist `<Mosquitto-Version>+<Paketnummer>`: `2.1.2+0` ist das erste Paket mit
Mosquitto 2.1.2, `2.1.2+1` eine Änderung am Addon mit demselben Mosquitto. Ein GitHub-Workflow prüft
täglich auf neue Mosquitto-Releases, baut die Pakete, testet sie und veröffentlicht das Release.

## Entwicklung

[BUILD.md](BUILD.md) beschreibt den Build (Mosquitto wird in Alpine-Containern aus dem Quelltext
gebaut, die Binaries werden per `patchelf` in den Addon-Pfad verankert) und die Tests; die
Planung wird außerhalb dieses Repositories gepflegt.

## Lizenzen

* ccu-addon-mosquitto © 2018-2026 Sebastian Raff und Contributors, dual lizenziert unter der
  [Eclipse Public License 1.0](epl-v10) und der [Eclipse Distribution License 1.0](edl-v10)
* [Mosquitto](https://mosquitto.org/) © Roger Light und Contributors, EPL-2.0 / EDL-1.0
* Die Lizenzen der mitgelieferten Bibliotheken (musl, OpenSSL, cJSON) stehen in der
  Konfigurationsseite unter _Lizenzen_

## English

Mosquitto MQTT broker as an addon for the Homematic CCU3 and OpenCCU (armv7l, aarch64, x86_64).
Upload the package for your platform (see the table above) under _Settings > Control panel >
Additional software_; on a CCU3 open the listener ports in the firewall afterwards. The
configuration page (listeners with per-listener anonymous access, TLS certificate, authentication
with password-file users, ACL, logging, persistence, process control, log download, one-click
update) is reached from the same place. `etc/mosquitto.conf` can also be edited by hand; the page
keeps lines it does not manage. A UI for the ACL file or the Dynamic Security plugin is out of
scope – [she](https://github.com/hobbyquaker/she) manages Mosquitto users, roles and ACLs.
Versions are `<mosquitto version>+<package build>`; a new package is released automatically for
every Mosquitto release.

The same package also runs on [openccu-lite](https://github.com/hobbyquaker/openccu-lite), the
ReGa-less CCU firmware: the addon only ever asks the ReGa for the settings page's session check,
which openccu-lite's `tclrega.so` shim answers. There it is installed from the system's addon catalogue
(_Addons → Catalogue_), and since the broker needs no interface process it starts right after the
network, before `rfd` and `hmipserver`. Logs go to the journal instead of
`/var/log/messages`, the firewall defaults to `RESTRICTIVE`, and the rc.d script runs under a
generated `addon-mosquitto.service`. See the [openccu-lite section](#openccu-lite) above for the
details, including what an addon running as its own confined user can and cannot do.
