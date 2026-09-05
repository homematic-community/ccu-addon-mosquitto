#!/bin/tclsh
#
#   CCU firewall status and port release for the settings page (ROADMAP
#   task 13). CCU session required.
#
#     ?cmd=status&sid=@...@              {"mode":"MOST_OPEN"|"RESTRICTIVE",
#                                         "userports":[...],"available":true}
#     ?cmd=open&sid=@...@  POST ports=1883,8883
#                                        adds the ports to the user ports
#                                        ("Port-Freigabe"), saves and applies
#
#   Uses the firmware's own /lib/libfirewall.tcl - the same procedures the
#   CCU's firewall page (Firewall.setConfiguration) runs, so the ports show
#   up there as well. In MOST_OPEN mode (INPUT policy ACCEPT) every port is
#   reachable anyway; in RESTRICTIVE mode only the firmware services and the
#   user ports pass.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set LIB /lib/libfirewall.tcl

puts -nonewline "Content-Type: application/json; charset=utf-8\r\n\r\n"

if {![info exists sid] || ![check_session $sid]} {
    puts {{"error":"invalid session"}}
    exit 0
}
if {![info exists cmd]} {
    set cmd status
}

if {![file exists $LIB]} {
    puts {{"available":false}}
    exit 0
}
source $LIB
Firewall_loadConfiguration

proc status_json {} {
    global Firewall_MODE Firewall_USER_PORTS
    set ports {}
    foreach p $Firewall_USER_PORTS {
        set p [string trim $p]
        if {[regexp {^[0-9]+$} $p]} {
            lappend ports $p
        }
    }
    return "{\"available\":true,\"mode\":[json_string $Firewall_MODE],\"userports\":\[[join $ports ,]\]}"
}

if {$cmd == "status"} {
    puts [status_json]
    exit 0
}

if {$cmd == "open"} {
    read_form body
    set wanted {}
    if {[info exists body(ports)]} {
        foreach p [split $body(ports) ", ;"] {
            set p [string trim $p]
            if {[regexp {^[0-9]+$} $p] && $p >= 1 && $p <= 65535} {
                lappend wanted $p
            }
        }
    }
    if {[llength $wanted] == 0} {
        puts {{"error":"keine gültigen Ports"}}
        exit 0
    }
    set changed 0
    foreach p $wanted {
        if {[lsearch -exact $Firewall_USER_PORTS $p] < 0} {
            lappend Firewall_USER_PORTS $p
            set changed 1
        }
    }
    if {$changed} {
        Firewall_saveConfiguration
        Firewall_configureFirewall
        catch {exec logger -t mosquitto -p daemon.info "firewall: user ports now $Firewall_USER_PORTS"}
    }
    puts [status_json]
    exit 0
}

puts {{"error":"unknown command"}}
