#!/bin/tclsh
#
#   Writes the POST body to etc/mosquitto.conf - after Mosquitto itself has
#   checked it (--test-config, since 2.1): an invalid file is not installed,
#   the broker's error message goes back to the page instead. The previous
#   file is kept as mosquitto.conf.bak.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set ADDON_DIR /usr/local/addons/mosquitto
set CONFIG $ADDON_DIR/etc/mosquitto.conf

puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"

if {![info exists sid] || ![check_session $sid]} {
    puts {error: invalid session}
    exit 0
}

fconfigure stdin -translation binary
set data [read stdin]
if {[string trim $data] == ""} {
    puts {error: empty configuration}
    exit 0
}

set fp [open "$CONFIG.new" w]
fconfigure $fp -translation binary
puts -nonewline $fp $data
close $fp

# The check runs on a copy with persistence switched off (the last
# directive wins): even with --test-config the broker saves its (empty)
# in-memory database on exit, which would clobber the running broker's
# var/mosquitto.db.
set fp [open "$CONFIG.test" w]
fconfigure $fp -translation binary
puts -nonewline $fp $data
puts $fp "\npersistence false"
close $fp
set rc [catch {exec $ADDON_DIR/bin/mosquitto -c $CONFIG.test --test-config 2>@1} result]
file delete -force "$CONFIG.test"
if {$rc} {
    file delete -force "$CONFIG.new"
    regsub -all {\n?child process exited abnormally$} $result "" result
    # keep the error lines only
    set lines {}
    foreach line [split $result "\n"] {
        if {[regexp {Error|error|Warning} $line]} {
            lappend lines [regsub {^[0-9]+: } $line ""]
        }
    }
    if {[llength $lines] == 0} {
        set lines [list $result]
    }
    puts "error: [join $lines { }]"
    exit 0
}

catch {file copy -force $CONFIG "$CONFIG.bak"}
file rename -force "$CONFIG.new" $CONFIG
puts "ok"
