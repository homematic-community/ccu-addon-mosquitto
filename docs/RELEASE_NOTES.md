### Neu in 2.1.2+2: openccu-lite, Paketnamen

- **[openccu-lite](https://github.com/hobbyquaker/openccu-lite)** – die CCU-Firmware ohne ReGaHSS
  und mit systemd – wird unterstützt, mit demselben Paket. Das Addon spricht die ReGa nur für die
  Sitzungsprüfung der Konfigurationsseite an, und genau diesen Aufruf beantwortet deren
  `tclrega.so`-Shim. Zwei Stellen erkennen die Zentrale jetzt zur Laufzeit: die letzte
  Fehlermeldung eines fehlgeschlagenen Starts und der Log-Download kommen aus dem systemd-Journal,
  wenn es kein `/var/log/messages` gibt, und die PID-Datei liegt im Addon-Verzeichnis statt unter
  `/var/run`, wenn der Dienst nicht als root läuft. Auf CCU3 und OpenCCU ändert sich dadurch
  nichts. Details und Einschränkungen stehen im Abschnitt _openccu-lite_ der README.
- **Paketnamen:** das armv7l-Paket heißt jetzt auch `mosquitto-armv7l-<version>.tar.gz` und liegt
  zusätzlich weiterhin als `mosquitto-<version>.tar.gz` bei – dieselbe Datei unter beiden Namen.
  Damit finden Addon-Kataloge alle drei Architekturen unter einem einheitlichen Schema, und alte
  Links funktionieren weiter.

### Mosquitto 2.1 statt 1.5.8 – bitte vor dem Update lesen

Dieses Release ersetzt das seit 2022 nicht mehr gepflegte Paket 1.5.8+4 durch ein komplett neu
gebautes Addon. **Vor dem Update ein CCU-Backup anlegen.**

- **Mosquitto 2.1.x** (bisher 1.5.8) mit OpenSSL 3, eingebauter WebSockets-Unterstützung,
  Passwortdatei- und ACL-Plugin sowie dem Dynamic-Security-Plugin; dazu `mosquitto_sub`,
  `mosquitto_pub`, `mosquitto_ctrl` und `mosquitto_passwd`. TLS 1.1 wird nicht mehr unterstützt.
- **Drei Plattformen:** CCU3/armv7l wie bisher, neu OpenCCU aarch64 und x86_64. Die Binaries
  bringen ihre Laufzeitumgebung mit (musl, OpenSSL, cJSON), die Firmware-Bibliotheken werden
  nicht mehr angefasst.
- **Konfigurationsseite** in der CCU-Oberfläche (Listener, Zertifikat, Authentifizierung mit
  Benutzerverwaltung, Logging, Persistenz, Prozesssteuerung, Log-Download) und **Update per Klick**.
- **Konfiguration:** eine Datei `etc/mosquitto.conf` statt `etc/conf.d/*.conf`. Beim Update werden
  die alten Schnipsel automatisch übernommen (inklusive der TLS-Listener, die das alte Addon bei
  fehlendem `server.pem` als `.disabled` abgelegt hatte); das alte Verzeichnis bleibt als
  `etc/conf.d.old` erhalten.
- **Anonyme Verbindungen:** Mosquitto 2.x lehnt ohne `allow_anonymous true` alle Clients ab.
  Die Standardkonfiguration und die Migration von 1.5.8 setzen `allow_anonymous true`, damit sich
  nichts am Verhalten ändert. Wer Authentifizierung möchte, schaltet auf der Konfigurationsseite
  anonyme Verbindungen ab und legt Benutzer in der Passwortdatei an.
- **Versionsschema:** `<Mosquitto-Version>+<Paketnummer>`, z. B. `2.1.2+0`. Neue Mosquitto-Versionen
  werden automatisch als Release veröffentlicht.
- Voraussetzung: CCU3 mit Firmware ab 3.61.5 oder aktuelles OpenCCU. CCU2 wird nicht unterstützt.
