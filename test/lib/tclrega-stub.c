/* Stub of the CCU firmware's tclrega.so for the web UI tests: rega_script
 * answers like the real one (a list STDOUT <output> sessionId {} httpUserAgent {})
 * and treats a session id as valid when it equals the content of /tmp/valid-sid. */
#include <tcl.h>

static const char *script =
    "proc rega_script {s} {\n"
    "  set sid {}\n"
    "  regexp {GetSessionVarStr[(]'([^']*)'[)]} $s m sid\n"
    "  set valid {}\n"
    "  if {$sid != {} && [file exists /tmp/valid-sid]} {\n"
    "    set f [open /tmp/valid-sid]\n"
    "    set v [string trim [read $f]]\n"
    "    close $f\n"
    "    if {$v == $sid} { set valid {1;Admin} }\n"
    "  }\n"
    "  return [list STDOUT $valid sessionId {} httpUserAgent {}]\n"
    "}\n";

int Tclrega_Init(Tcl_Interp *interp) {
    return Tcl_Eval(interp, script);
}
