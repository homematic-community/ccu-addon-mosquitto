#
#   CCU session check for the CGIs: every request that reads or changes the
#   configuration or controls the service must carry a valid WebUI session
#   id (sid=@xxxxxxxxxx@, handed over by the CCU when it opens the settings
#   page). Same mechanism as RedMatic.
#

load tclrega.so

proc check_session sid {
    if {[regexp {@([0-9a-zA-Z]{10})@} $sid all sidnr]} {
        set res [lindex [rega_script "Write(system.GetSessionVarStr('$sidnr'));"] 1]
        if {$res != ""} {
            return 1
        }
    }
    return 0
}
