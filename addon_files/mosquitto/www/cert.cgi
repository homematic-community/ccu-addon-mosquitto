#!/bin/tclsh
#
#   Server certificate helpers for the settings page (CCU session required).
#
#     ?cmd=info&sid=@...@&file=<path>   subject, issuer, validity of a PEM
#                                       certificate (text, via openssl x509)
#     ?cmd=generate&sid=@...@           POST cn=<name>: creates a self-signed
#                                       certificate etc/certs/server.crt +
#                                       server.key (RSA 2048, 10 years, SANs =
#                                       hostname and the current IP addresses)
#
#   openssl is part of every CCU firmware (1.0.2 on the CCU3, 3.x on OpenCCU);
#   the SANs go through a config file because -addext needs 1.1.1.
#

source ../lib/querystring.tcl
source ../lib/session.tcl

set ADDON_DIR /usr/local/addons/mosquitto
set CERT_DIR $ADDON_DIR/etc/certs

puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"

if {![info exists sid] || ![check_session $sid]} {
    puts {error: invalid session}
    exit 0
}
if {![info exists cmd]} {
    set cmd info
}

if {$cmd == "info"} {
    if {![info exists file] || ![file exists $file]} {
        puts "error: Datei nicht gefunden"
        exit 0
    }
    if {[catch {run openssl x509 -in $file -noout -subject -issuer -startdate -enddate} result]} {
        regsub -all {\n?child process exited abnormally$} $result "" result
        puts "error: $result"
        exit 0
    }
    puts $result
    exit 0
}

if {$cmd == "generate"} {
    read_form body
    set host [string trim [exec hostname]]
    set cn $host
    if {[info exists body(cn)] && [regexp {^[A-Za-z0-9.-]{1,64}$} [string trim $body(cn)]]} {
        set cn [string trim $body(cn)]
    }
    set sans [list "DNS:$cn"]
    if {$cn != $host} {
        lappend sans "DNS:$host"
    }
    # lighttpd's PATH has no /sbin
    foreach ipbin {/sbin/ip /bin/ip /usr/sbin/ip ip} {
        if {![catch {exec $ipbin -o -4 addr show scope global} addrs]} {
            foreach line [split $addrs "\n"] {
                if {[regexp {inet ([0-9.]+)/} $line dummy ip]} {
                    lappend sans "IP:$ip"
                }
            }
            break
        }
    }
    file mkdir $CERT_DIR
    set cnf "$CERT_DIR/openssl.cnf"
    set fp [open $cnf w]
    puts $fp "\[req\]"
    puts $fp "distinguished_name = dn"
    puts $fp "x509_extensions = v3"
    puts $fp "prompt = no"
    puts $fp "\[dn\]"
    puts $fp "CN = $cn"
    puts $fp "\[v3\]"
    puts $fp "subjectAltName = [join $sans ,]"
    puts $fp "basicConstraints = CA:FALSE"
    puts $fp "keyUsage = digitalSignature, keyEncipherment"
    puts $fp "extendedKeyUsage = serverAuth"
    close $fp
    set rc [catch {run openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
        -config $cnf -keyout "$CERT_DIR/server.key.new" -out "$CERT_DIR/server.crt.new"} result]
    file delete -force $cnf
    if {$rc} {
        file delete -force "$CERT_DIR/server.key.new" "$CERT_DIR/server.crt.new"
        regsub -all {\n?child process exited abnormally$} $result "" result
        puts "error: openssl: $result"
        exit 0
    }
    file rename -force "$CERT_DIR/server.key.new" "$CERT_DIR/server.key"
    file rename -force "$CERT_DIR/server.crt.new" "$CERT_DIR/server.crt"
    catch {file attributes "$CERT_DIR/server.key" -permissions 0600}
    puts "ok"
    exit 0
}

puts {error: unknown command}
