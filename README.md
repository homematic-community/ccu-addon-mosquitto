# ccu-addon-mosquitto

[![Github Releases](https://img.shields.io/github/downloads/hobbyquaker/ccu-addon-mosquitto/latest/total.svg)](https://github.com/hobbyquaker/ccu-addon-mosquitto/releases)

[Mosquitto](https://mosquitto.org/) als Addon für die
[Homematic CCU3](https://www.eq-3.de/produkte/homematic/zentralen-und-gateways/smart-home-zentrale-ccu3.html) und 
[RaspberryMatic](https://github.com/jens-maus/RaspberryMatic)

Unter [Releases](https://github.com/hobbyquaker/ccu-addon-mosquitto/releases) steht die Datei 
`mosquitto-<version>.tar.gz` zum Download zur Verfügung, diese kann über das CCU WebUI als Zusatzsoftware installiert
werden.

Die Mosquitto Konfiguration ist unter `/usr/local/addons/mosquitto/etc/conf.d/*.conf` zu finden.
Neustart via `/etc/config/rc.d/mosquitto restart`.

Falls eigene Konfigurationen vorgenommen werden sollten diese nicht in den vorhandenen conf Dateien eingetragen werden
(da diese bei einem evtl Update überschrieben werden). Empfehlung: `conf.d/custom-xyz.conf`.

Per default lauscht Mosquitto auf den Ports 1883/mqtt und 1884/wss. Falls auf der CCU ein Zertifikat vorhanden ist 
werden automatisch auch TLS listener geöffnet (8883/mqtts und 8884/wss)


## Credits

Mosquitto was written by Roger Light <roger@atchoo.org>
