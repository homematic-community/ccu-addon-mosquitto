#
#   Query string and form body parsing plus small helpers for the CGIs.
#
#   The query string parameters become Tcl variables (sid, cmd, file, force),
#   URL decoded. A POST body in application/x-www-form-urlencoded form is
#   read with [read_form] into an array.
#
#   Everything here must run on Tcl 8.2 (original CCU3 firmware): no dict,
#   no {*}, no eq/ne, no 2>@1.
#

# run <cmd> <arg>...: exec with stderr merged into the result (Tcl 8.2 has
# no 2>@1). Raises like exec on a non-zero exit code.
proc shell_quote {s} {
    return "'[string map [list "'" "'\\''"] $s]'"
}
proc run {args} {
    set cmd ""
    foreach a $args {
        append cmd [shell_quote $a] " "
    }
    return [exec sh -c "$cmd 2>&1"]
}

# Request bytes pass through unchanged: the decoded value stays a byte string
# and the system encoding is iso8859-1, so a password with an umlaut reaches
# mosquitto_passwd as the same UTF-8 bytes an MQTT client sends. (Tcl would
# otherwise re-encode it with the CGI's locale.)
catch {encoding system iso8859-1}

# character by character on purpose: no [subst] on user input
proc urldecode {str} {
    set str [string map {+ " "} $str]
    set out ""
    set len [string length $str]
    set i 0
    while {$i < $len} {
        set c [string index $str $i]
        if {$c == "%" && [regexp {^[0-9A-Fa-f]{2}$} [string range $str [expr {$i + 1}] [expr {$i + 2}]] hex]} {
            # (scan into a variable: Tcl 8.2 has no value-returning form)
            scan $hex %x code
            append out [binary format c $code]
            incr i 3
        } else {
            append out $c
            incr i
        }
    }
    return $out
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
