#
#   Query string and form body parsing for the CGIs.
#
#   The query string parameters become Tcl variables (sid, cmd, file, force),
#   URL decoded. A POST body in application/x-www-form-urlencoded form is
#   read with [read_form] into an array.
#

# character by character on purpose: no [subst] on user input
proc urldecode {str} {
    set str [string map {+ " "} $str]
    set out ""
    set len [string length $str]
    set i 0
    while {$i < $len} {
        set c [string index $str $i]
        if {$c eq "%" && [regexp {^[0-9A-Fa-f]{2}$} [string range $str [expr {$i + 1}] [expr {$i + 2}]] hex]} {
            append out [binary format c [scan $hex %x]]
            incr i 3
        } else {
            append out $c
            incr i
        }
    }
    return [encoding convertfrom utf-8 $out]
}

proc parse_pairs {input arrayName} {
    upvar $arrayName arr
    foreach pair [split $input &] {
        if {[regexp {^([^=]*)=(.*)$} $pair dummy name val]} {
            set arr([urldecode $name]) [urldecode $val]
        }
    }
}

# the POST body as an array: read_form body -> $body(user), $body(password)
proc read_form {arrayName} {
    upvar $arrayName arr
    array set arr {}
    fconfigure stdin -translation binary
    set data [read stdin]
    parse_pairs $data arr
}

# minimal JSON string quoting for the responses
proc json_string {str} {
    set str [string map {\\ \\\\ \" \\\" \n \\n \r \\r \t \\t} $str]
    return "\"$str\""
}

catch {
    array set query {}
    parse_pairs $env(QUERY_STRING) query
    foreach name {sid cmd file force} {
        if {[info exists query($name)]} {
            set $name $query($name)
        }
    }
}
