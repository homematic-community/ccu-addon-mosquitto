#!/bin/tclsh
#
#   Entry point of the settings page: the CCU WebUI opens it with the
#   session id (?sid=@xxxxxxxxxx@). Serves settings.html when the session is
#   valid, session-error.html otherwise. The page itself passes the sid on
#   to every CGI it calls.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set WWW /usr/local/addons/mosquitto/www

puts -nonewline "Content-Type: text/html; charset=utf-8\r\n\r\n"

if {[info exists sid] && [check_session $sid]} {
    set fp [open "$WWW/settings.html" r]
} else {
    set fp [open "$WWW/session-error.html" r]
}
fconfigure $fp -translation binary
puts -nonewline [read $fp]
close $fp
