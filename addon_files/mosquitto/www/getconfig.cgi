#!/bin/tclsh
#
#   Returns etc/mosquitto.conf as text. The settings page parses it in the
#   browser (js/script.js) and writes it back through setconfig.cgi.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"

if {[info exists sid] && [check_session $sid]} {
    set fp [open "/usr/local/addons/mosquitto/etc/mosquitto.conf" r]
    fconfigure $fp -translation binary
    puts -nonewline [read $fp]
    close $fp
} else {
    puts {error: invalid session}
}
