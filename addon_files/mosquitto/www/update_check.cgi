#!/bin/tclsh
#
#   Update check, called by the CCU WebUI (Zusatzsoftware page) and by the
#   settings page.
#
#     (no cmd)         newest released version on GitHub, or "n/a"
#     ?cmd=download    redirect to the GitHub releases page
#
#   Only full releases count (releases/latest excludes drafts and
#   prereleases). Versions look like 2.1.2+0; the old 1.5.8+4 releases had no
#   "v" prefix and neither do the new ones.
#

set checkURL    "https://api.github.com/repos/homematic-community/ccu-addon-mosquitto/releases/latest"
set downloadURL "https://github.com/homematic-community/ccu-addon-mosquitto/releases/latest"

source ../lib/querystring.tcl

if {[info exists cmd] && $cmd == "download"} {
    puts -nonewline "Content-Type: text/html; charset=utf-8\r\n\r\n"
    puts "<html><head><meta http-equiv='refresh' content='0; url=$downloadURL' /></head></html>"
    exit 0
}

puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"
catch {
    regexp {"tag_name":\s*"v?([0-9]+\.[0-9]+\.[0-9]+\+[0-9]+)"} [exec /usr/bin/env curl -fsSL --max-time 15 $checkURL] dummy newversion
}
if {[info exists newversion]} {
    puts -nonewline $newversion
} else {
    puts -nonewline "n/a"
}
