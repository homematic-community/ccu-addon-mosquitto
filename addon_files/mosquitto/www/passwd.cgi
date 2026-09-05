#!/bin/tclsh
#
#   Password file management (etc/passwd) for the settings page, using the
#   bundled mosquitto_passwd. Every command needs the CCU session.
#
#     ?cmd=list&sid=@...@              JSON array of user names
#     ?cmd=set&sid=@...@   POST user=...&password=...   add or change
#     ?cmd=delete&sid=@...@ POST user=...
#
#   Passwords travel in the POST body, never in the query string (lighttpd
#   logs it). After a change the running broker gets a SIGHUP, which makes
#   the password-file plugin re-read the file.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set ADDON_DIR /usr/local/addons/mosquitto
set PASSWD $ADDON_DIR/etc/passwd
set MOSQUITTO_PASSWD $ADDON_DIR/bin/mosquitto_passwd
set RC /usr/local/etc/config/rc.d/mosquitto

puts -nonewline "Content-Type: application/json; charset=utf-8\r\n\r\n"

proc fail {msg} {
    puts "{\"error\":[json_string $msg]}"
    exit 0
}

proc users {} {
    global PASSWD
    set names {}
    if {![catch {set fp [open $PASSWD r]}]} {
        while {[gets $fp line] >= 0} {
            if {[regexp {^([^:#][^:]*):} $line dummy name]} {
                lappend names $name
            }
        }
        close $fp
    }
    return $names
}

proc user_list_json {} {
    set items {}
    foreach name [lsort [users]] {
        lappend items [json_string $name]
    }
    return "\[[join $items ,]\]"
}

if {![info exists sid] || ![check_session $sid]} {
    fail "invalid session"
}
if {![info exists cmd]} {
    set cmd list
}

if {$cmd == "list"} {
    puts "{\"file\":[json_string $PASSWD],\"exists\":[expr {[file exists $PASSWD] ? "true" : "false"}],\"users\":[user_list_json]}"
    exit 0
}

read_form body
set user ""
if {[info exists body(user)]} {
    set user [string trim $body(user)]
}
if {![regexp {^[A-Za-z0-9._@+-]{1,64}$} $user]} {
    fail "Benutzername: nur Buchstaben, Ziffern und . _ @ + - (1-64 Zeichen)"
}

if {$cmd == "set"} {
    set password ""
    if {[info exists body(password)]} {
        set password $body(password)
    }
    if {[string length $password] < 1 || [string length $password] > 128} {
        fail "Passwort: 1-128 Zeichen"
    }
    if {[file exists $PASSWD]} {
        set args [list $MOSQUITTO_PASSWD -b $PASSWD $user $password]
    } else {
        set args [list $MOSQUITTO_PASSWD -c -b $PASSWD $user $password]
    }
    if {[catch {exec {*}$args 2>@1} result]} {
        regsub -all {\n?child process exited abnormally$} $result "" result
        fail "mosquitto_passwd: $result"
    }
    catch {file attributes $PASSWD -permissions 0600}
} elseif {$cmd == "delete"} {
    if {![file exists $PASSWD]} {
        fail "keine Passwortdatei vorhanden"
    }
    if {[catch {exec $MOSQUITTO_PASSWD -D $PASSWD $user 2>@1} result]} {
        regsub -all {\n?child process exited abnormally$} $result "" result
        fail "mosquitto_passwd: $result"
    }
} else {
    fail "unknown command"
}

# the password-file plugin re-reads the file on SIGHUP
catch {exec $RC reload}

puts "{\"ok\":true,\"users\":[user_list_json]}"
