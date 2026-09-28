#!/bin/tclsh
#
#   Entry point of the settings page: the CCU WebUI opens it with the
#   session id (?sid=@xxxxxxxxxx@), openccu-lite without it and with its
#   session header (task 21). Serves settings.html when the session is
#   valid, session-error.html otherwise. The page itself passes a sid on to
#   every CGI it calls when it got one.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set WWW /usr/local/addons/mosquitto/www

puts -nonewline "Content-Type: text/html; charset=utf-8\r\n\r\n"

if {[request_session_ok]} {
    set fp [open "$WWW/settings.html" r]
} else {
    set fp [open "$WWW/session-error.html" r]
}
fconfigure $fp -translation binary
puts -nonewline [read $fp]
close $fp
