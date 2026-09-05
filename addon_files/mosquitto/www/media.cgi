#!/bin/tclsh
#
#   Storage locations for the persistence database (ROADMAP task 15). CCU
#   session required.
#
#     ?cmd=list&sid=@...@                     mounted USB sticks under /media
#     ?cmd=check&sid=@...@&file=<path>        is the path usable
#
#   JSON: {"media":[{"path":"/media/usb1","fs":"vfat","free_mb":1234}, ...]}
#         {"path":"...","exists":true,"mounted":true,"free_mb":123,"writable":true}
#
#   The CCU firmwares mount USB sticks at /media/usb<N> (CCU3: the mount
#   points usb1..usb8 always exist as empty directories on a tmpfs, so a
#   directory alone means nothing - only a mount counts). Tcl 8.2 compatible.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

puts -nonewline "Content-Type: application/json; charset=utf-8\r\n\r\n"

if {![info exists sid] || ![check_session $sid]} {
    puts {{"error":"invalid session"}}
    exit 0
}
if {![info exists cmd]} {
    set cmd list
}

# mount point -> filesystem type, from /proc/mounts
proc mounts {} {
    set result {}
    if {![catch {set fp [open /proc/mounts r]}]} {
        while {[gets $fp line] >= 0} {
            set fields [split $line " "]
            if {[llength $fields] >= 3} {
                lappend result [lindex $fields 1] [lindex $fields 2]
            }
        }
        close $fp
    }
    return $result
}

# the mount point a path lives on (longest matching prefix), or ""
proc mount_of {path mountlist} {
    set best ""
    set bestlen -1
    foreach {mp fs} $mountlist {
        set mpn $mp
        if {$mpn != "/"} { set mpn [string trimright $mp "/"] }
        set len [string length $mpn]
        if {$path == $mpn || [string range $path 0 $len] == "$mpn/" || $mpn == "/"} {
            if {$len > $bestlen} {
                set best $mp
                set bestlen $len
            }
        }
    }
    return $best
}

proc fs_of {mp mountlist} {
    foreach {m fs} $mountlist {
        if {$m == $mp} { return $fs }
    }
    return ""
}

proc free_mb {path} {
    if {[catch {exec df -Pk $path} out]} {
        return 0
    }
    set line [lindex [split $out "\n"] 1]
    set free [lindex $line 3]
    if {![regexp {^[0-9]+$} $free]} { return 0 }
    return [expr {$free / 1024}]
}

set mountlist [mounts]

if {$cmd == "list"} {
    set items {}
    foreach {mp fs} $mountlist {
        if {[regexp {^/media/[^/]+$} $mp] && $fs != "tmpfs" && $fs != "devtmpfs"} {
            lappend items "{\"path\":[json_string $mp],\"fs\":[json_string $fs],\"free_mb\":[free_mb $mp]}"
        }
    }
    puts "{\"media\":\[[join $items ,]\]}"
    exit 0
}

if {$cmd == "check"} {
    if {![info exists file] || $file == ""} {
        puts {{"error":"no path"}}
        exit 0
    }
    set path [string trimright $file "/"]
    if {$path == ""} { set path "/" }
    set exists [file isdirectory $path]
    set mp [mount_of $path $mountlist]
    set fs [fs_of $mp $mountlist]
    # under /media only a real mount counts (the empty mount points are on a tmpfs)
    set mounted 1
    if {[string match "/media/*" $path] && ($mp == "/media" || $fs == "tmpfs")} {
        set mounted 0
    }
    set writable 0
    if {$exists} {
        set probe "$path/.mosquitto-write-test"
        if {![catch {set fp [open $probe w]}]} {
            close $fp
            file delete -force $probe
            set writable 1
        }
    }
    set free 0
    if {$exists} { set free [free_mb $path] }
    puts "{\"path\":[json_string $path],\"exists\":[expr {$exists ? "true" : "false"}],\"mounted\":[expr {$mounted ? "true" : "false"}],\"fs\":[json_string $fs],\"free_mb\":$free,\"writable\":[expr {$writable ? "true" : "false"}]}"
    exit 0
}

puts {{"error":"unknown command"}}
