# Stub of the CCU firmware's /lib/libfirewall.tcl for the web UI tests: the
# same procedures and globals, state in /tmp/firewall.conf, "applied" marks
# in /tmp/firewall.applied instead of iptables.
set Firewall_MODE MOST_OPEN
set Firewall_USER_PORTS {}
set Firewall_CONF /tmp/firewall.conf
proc Firewall_loadConfiguration {} {
    global Firewall_MODE Firewall_USER_PORTS Firewall_CONF
    if {[file exists $Firewall_CONF]} { source $Firewall_CONF }
}
proc Firewall_saveConfiguration {} {
    global Firewall_MODE Firewall_USER_PORTS Firewall_CONF
    set f [open $Firewall_CONF w]
    puts $f "set Firewall_MODE $Firewall_MODE"
    puts $f "set Firewall_USER_PORTS [list $Firewall_USER_PORTS]"
    close $f
}
proc Firewall_configureFirewall {} {
    set f [open /tmp/firewall.applied a]
    puts $f "applied [clock seconds]"
    close $f
}
