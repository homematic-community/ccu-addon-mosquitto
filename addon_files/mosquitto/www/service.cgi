#!/bin/tclsh
#
#   Process control and status for the settings page.
#
#     ?cmd=status                   JSON from `mosquitto-service status`
#     ?cmd=versions                 JSON of the addon's versions file
#     ?cmd=start|stop|restart|reload&sid=@...@
#
#   status and versions need no session, like RedMatic's service.cgi?cmd=ps:
#   the page polls status every few seconds and both expose nothing but
#   version numbers, a pid and memory figures.
#

source ../lib/querystring.tcl

set RC /usr/local/etc/config/rc.d/mosquitto
set ADDON_DIR /usr/local/addons/mosquitto

if {![info exists cmd]} {
    set cmd status
}

if {$cmd == "status"} {
    puts -nonewline "Content-Type: application/json; charset=utf-8\r\n\r\n"
    if {[catch {exec $RC status} result]} {
        # exit code 1 = not running, the JSON is still on stdout
        regsub -all {\n?child process exited abnormally$} $result "" result
    }
    # (no literal brace inside the braced condition: Tcl counts it)
    if {[string compare [string index [string trim $result] 0] "\{"] != 0} {
        set result {{"running":false}}
    }
    puts $result
    exit 0
}

if {$cmd == "versions"} {
    puts -nonewline "Content-Type: application/json; charset=utf-8\r\n\r\n"
    set items {}
    catch {
        set fp [open "$ADDON_DIR/versions" r]
        while {[gets $fp line] >= 0} {
            if {[regexp {^export ([A-Z0-9_]+)=(.*)$} $line dummy key val]} {
                lappend items "[json_string $key]:[json_string $val]"
            }
        }
        close $fp
    }
    puts "{[join $items ,]}"
    exit 0
}

puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"

if {$cmd == "stop" || $cmd == "start" || $cmd == "restart" || $cmd == "reload"} {
    source ../lib/session.tcl
    if {[info exists sid] && [check_session $sid]} {
        catch {run $RC $cmd} result
        regsub -all {\n?child process exited abnormally$} $result "" result
        puts $result
        exit 0
    } else {
        puts {error: invalid session}
        exit 0
    }
}

puts {error: invalid command}
