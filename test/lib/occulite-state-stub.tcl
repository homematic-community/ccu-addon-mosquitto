# Stub of openccu-lite's GET /api/auth/v1/state for the web UI tests (task 21): the session in
# /tmp/occulite-live-sid is a live one, TOKENONLYTOKENONLY is an API token (no sid in the answer),
# everything else is unknown. Every request is logged to /tmp/occulite-state.log.
set auth ""
catch {set auth $env(HTTP_AUTHORIZATION)}
set live ""
catch {
    set f [open /tmp/occulite-live-sid]
    set live [string trim [read $f]]
    close $f
}
set log [open /tmp/occulite-state.log a]
puts $log "GET /api/auth/v1/state $auth"
close $log
if {$live != "" && $auth == "Bearer $live"} {
    puts -nonewline "Content-Type: application/json\r\n\r\n"
    puts "{\"authenticated\":true,\"sid\":\"$live\",\"user\":\"ui\",\"level\":\"administer\",\"role\":\"admin\"}"
} elseif {$auth == "Bearer TOKENONLYTOKENONLY"} {
    puts -nonewline "Content-Type: application/json\r\n\r\n"
    puts {{"authenticated":true,"user":"token:x","scopes":["*"]}}
} else {
    puts -nonewline "Status: 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n"
    puts {{"authenticated":false}}
}
