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
* Läuft auf der CCU3 (armv7l) und auf OpenCCU in den 64-bit-ARM- (aarch64) und x86_64-Varianten;
  die Binaries bringen ihre Laufzeitumgebung (musl, OpenSSL 3) selbst mit.
* Für jede Mosquitto-Version erscheint automatisch ein Release, siehe [Versionen](#versionen).

## Installation

1. Das passende Paket von der [Release-Seite](https://github.com/homematic-community/ccu-addon-mosquitto/releases/latest)
   laden:

   | Paket | Zentrale |
   | --- | --- |
   | `mosquitto-<version>.tar.gz` | CCU3 (Original-Firmware), piVCCU3, OpenCCU _rpi2_, _tinkerboard_, _oci_arm_ (armv7l) |
   | `mosquitto-aarch64-<version>.tar.gz` | OpenCCU _rpi3_, _rpi4_, _rpi5_, _oci_arm64_ (aarch64) |
   | `mosquitto-x86_64-<version>.tar.gz` | OpenCCU _ova_, _intelnuc_, _oci_amd64_ (x86_64) |

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
* **Listener** – Port, Bind-Adresse, MQTT oder WebSockets, TLS ein/aus, maximale Verbindungen;
  Listener hinzufügen und entfernen. Zu jedem Port steht, ob die CCU-Firewall ihn durchlässt;
  gesperrte Ports werden mit einer Schaltfläche in die Port-Freigabe der Firewall eingetragen.
* **Bridges** – Verbindungen zu anderen Brokern: Adresse(n), Login, Client-ID, Clean Session,
  Protokollversion, TLS (CA-Datei), Status-Nachrichten, `try_private` und die `topic`-Zeilen.
* **Zertifikat** für die TLS-Listener: das Zertifikat der CCU (`/etc/config/server.pem`), ein auf
  der CCU erzeugtes selbstsigniertes Zertifikat (`etc/certs/`) oder eigene Dateien; minimale
  TLS-Version.
* **Authentifizierung** – anonyme Verbindungen erlauben oder nicht, Passwortdatei mit
  Benutzerverwaltung (`etc/passwd`, Plugin `mosquitto_password_file`), ACL-Datei ein/aus
  (`etc/acl`, wird auf der Kommandozeile gepflegt).
* **Logging** – Log-Typen, Verbindungsmeldungen.
* **Persistenz** – ein/aus, Speicherintervall.
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

> **Hinweis zu Mosquitto 2.x:** Ohne `allow_anonymous true` und ohne Passwortdatei nimmt der
> Broker keine Verbindungen an (bei 1.5.8 waren anonyme Verbindungen der Standard). Das Addon
> setzt `allow_anonymous true` in der Standardkonfiguration und beim Update von 1.5.8.

## Update

Steht eine neue Version bereit, zeigt die Konfigurationsseite eine Schaltfläche _Herunterladen und
installieren_: das Paket wird von GitHub geladen, die Prüfsumme geprüft und wie über die
Zusatzsoftware-Seite installiert; Konfiguration und Persistenz bleiben erhalten. Alternativ das
neue Paket manuell über die Zusatzsoftware-Seite hochladen.

## Versionen

Die Addon-Version ist `<Mosquitto-Version>+<Paketnummer>`: `2.1.2+0` ist das erste Paket mit
Mosquitto 2.1.2, `2.1.2+1` eine Änderung am Addon mit demselben Mosquitto. Ein GitHub-Workflow prüft
täglich auf neue Mosquitto-Releases, baut die Pakete, testet sie und veröffentlicht das Release.

## Entwicklung

[BUILD.md](BUILD.md) beschreibt den Build (Mosquitto wird in Alpine-Containern aus dem Quelltext
gebaut, die Binaries werden per `patchelf` in den Addon-Pfad verankert) und die Tests,
[ROADMAP.md](ROADMAP.md) die Planung.

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
configuration page (listeners, TLS certificate, authentication with password-file users, ACL,
logging, persistence, process control, log download, one-click update) is reached from the same
place. `etc/mosquitto.conf` can also be edited by hand; the page keeps lines it does not manage.
Versions are `<mosquitto version>+<package build>`; a new package is released automatically for
every Mosquitto release.
