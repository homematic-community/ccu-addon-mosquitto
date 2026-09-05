#!/bin/tclsh
#
#   Debug download: versions, configuration, disk, sockets, firewall and the
#   mosquitto lines of the syslog. CCU session required.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set ADDON_DIR /usr/local/addons/mosquitto

puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"

if {![info exists sid] || ![check_session $sid]} {
    puts {error: invalid session}
    exit 0
}

proc section {title script} {
    puts "### $title"
    if {[catch $script result]} {
        regsub -all {\n?child process exited abnormally$} $result "" result
    }
    puts $result
    puts ""
}

section "versions" {exec cat $ADDON_DIR/versions}
section "uname" {exec uname -a}
section "/VERSION" {exec cat /VERSION}
section "service status" {exec /usr/local/etc/config/rc.d/mosquitto status}
section "etc/mosquitto.conf" {exec cat $ADDON_DIR/etc/mosquitto.conf}
section "etc" {exec ls -la $ADDON_DIR/etc $ADDON_DIR/etc/certs}
section "var" {exec ls -la $ADDON_DIR/var}
section "df -h" {exec df -h}
section "free" {exec free}
section "netstat" {exec netstat -tulpen 2>@1 | grep mosquitto}
section "iptables INPUT" {exec /usr/sbin/iptables -L INPUT -vn}
if {[file exists /var/log/messages.0]} {
    section "/var/log/messages.0" {exec grep -i mosquitto /var/log/messages.0}
}
section "/var/log/messages" {exec grep -i mosquitto /var/log/messages}
