#!/bin/bash
#
# Runs inside the e2e container (see test/e2e.sh): installs the x86_64
# package like OpenCCU's /bin/install_addon does and checks the result.
#

ADDON_DIR=/usr/local/addons/mosquitto
CONF_DIR=/usr/local/etc/config
RC=$CONF_DIR/rc.d/mosquitto
BIN=$ADDON_DIR/bin
CONFIG=$ADDON_DIR/etc/mosquitto.conf
PKG=`ls /dist/mosquitto-x86_64-*.tar.gz | head -1`
FAILED=0

log() { echo ""; echo "### $*"; }
ok() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; FAILED=1; }
die() { echo "FAIL: $*"; dump; exit 1; }

dump() {
    echo ""
    echo "### syslog (last 60 lines)"
    tail -60 /var/log/messages 2>/dev/null
}

# --- container preparation ---------------------------------------------------
log "prepare container"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null || die "apt-get update"
# tcl: bin/update_addon (the WebUI button) is a tclsh script like the CGIs
apt-get install -y -qq --no-install-recommends curl ca-certificates iproute2 procps busybox openssl tcl >/dev/null || die "apt-get install"
busybox syslogd -O /var/log/messages || die "syslogd"
mkdir -p /usr/local/tmp $CONF_DIR/rc.d $CONF_DIR/addons/www /etc/config
# the CCU runs the addon scripts with busybox ash, not dash
ln -sf /bin/busybox /bin/sh
# a CCU-style server.pem: certificate and key in one file
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 -subj "/CN=e2e-ccu" \
    -keyout /tmp/ccu.key -out /tmp/ccu.crt 2>/dev/null || die "openssl"
cat /tmp/ccu.crt /tmp/ccu.key > /etc/config/server.pem
ok "$PKG"

# what OpenCCU's /bin/install_addon does: extract into a temp dir below
# /usr/local/tmp, run update_script from inside it, delete the temp dir
install_addon() {
    local dir rc
    dir=`mktemp -d -p /usr/local/tmp`
    tar -C "$dir" --no-same-owner --no-same-permissions -xf "$PKG" || die "extract"
    (cd "$dir" && ./update_script HM-RASPBERRYMATIC >/tmp/update_script.log 2>&1)
    rc=$?
    rm -rf "$dir"
    return $rc
}

broker_pid() {
    pgrep -x mosquitto | head -1
}

# wait until the broker accepts a publish on the given port
wait_for_broker() {
    local port=${1:-1883} i
    for i in `seq 1 30`; do
        if $BIN/mosquitto_pub -h 127.0.0.1 -p $port -t e2e/ping -m 1 2>/dev/null; then
            return 0
        fi
        sleep 1
    done
    return 1
}

roundtrip() {
    # roundtrip <topic> <extra client args...>: publish and receive one message
    local topic=$1; shift
    local out
    out=`timeout 15 $BIN/mosquitto_sub -h 127.0.0.1 -C 1 -W 10 -t "$topic" "$@" & sleep 1; $BIN/mosquitto_pub -h 127.0.0.1 -t "$topic" -m "hello-$$" "$@"; wait`
    [ "$out" = "hello-$$" ]
}

# --- fresh install -----------------------------------------------------------
log "fresh install (update_script must exit 10 = reboot required)"
install_addon
rc=$?
[ $rc -eq 10 ] || { cat /tmp/update_script.log; die "update_script exit code $rc, expected 10"; }
ok "update_script exit 10"
[ -x $RC ] || die "rc.d/mosquitto link missing"
[ -f $CONFIG ] || die "etc/mosquitto.conf missing"
[ -L $CONF_DIR/addons/www/mosquitto ] || die "www link missing"
grep -q '^mosquitto ' $CONF_DIR/hm_addons.cfg || fail "hm_addons.cfg has no mosquitto entry"
. $ADDON_DIR/versions
ok "addon $VERSION_ADDON, Mosquitto $MOSQUITTO_VERSION, Alpine $ALPINE_VERSION"
$RC info | grep -q "^Version: $VERSION_ADDON" || fail "rc.d info does not report the version"

log "start"
$RC start || die "rc.d/mosquitto start"
wait_for_broker 1883 || die "broker does not answer on 1883"
ok "broker answers on 1883"
$RC status | grep -q '"running":true' || fail "status does not say running"
cwd=`readlink /proc/$(broker_pid)/cwd`
[ "$cwd" = "/" ] && ok "working directory of the broker is /" || fail "working directory is '$cwd'"
grep -q "mosquitto version $MOSQUITTO_VERSION starting" /var/log/messages || fail "no start line in syslog"

log "pub/sub round trip with the bundled clients"
roundtrip e2e/test && ok "message received" || fail "pub/sub round trip"

log "websockets listener (1884)"
code=`curl -s -o /dev/null -w '%{http_code}' --max-time 5 -N \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" -H "Sec-WebSocket-Protocol: mqtt" \
    http://127.0.0.1:1884/`
[ "$code" = "101" ] && ok "websocket upgrade answered 101" || fail "websocket upgrade answered '$code'"

log "TLS listeners of the default configuration (8883 mqtt, 8884 websockets, CCU certificate)"
grep -q '^listener 8883' $CONFIG && grep -q '^listener 8884' $CONFIG && ok "default config has the TLS listeners" || fail "default config lacks the TLS listeners"
roundtrip e2e/tls-default -p 8883 --cafile /etc/config/server.pem --insecure && ok "TLS round trip on 8883 with the CCU certificate" || fail "TLS round trip on 8883"
code=`curl -s -o /dev/null -w '%{http_code}' --max-time 5 -N -k \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" -H "Sec-WebSocket-Protocol: mqtt" \
    https://127.0.0.1:8884/`
[ "$code" = "101" ] && ok "websocket upgrade over TLS on 8884" || fail "websocket upgrade over TLS answered '$code'"

# --- configuration: password file (what the settings page writes) ------------------
log "password-file plugin"
cat >> $CONFIG <<EOL

plugin $ADDON_DIR/lib/mosquitto_password_file.so
plugin_opt_password_file $ADDON_DIR/etc/passwd
EOL
sed -i 's/^allow_anonymous true/allow_anonymous false/' $CONFIG
$BIN/mosquitto_passwd -c -b $ADDON_DIR/etc/passwd e2e secret >/dev/null || die "mosquitto_passwd"
$BIN/mosquitto -c $CONFIG --test-config >/dev/null 2>&1 && ok "--test-config accepts the config" || fail "--test-config rejects the config"
$RC restart || die "restart"
wait_for_broker_auth() {
    local i
    for i in `seq 1 30`; do
        $BIN/mosquitto_pub -h 127.0.0.1 -u e2e -P secret -t e2e/ping -m 1 2>/dev/null && return 0
        sleep 1
    done
    return 1
}
wait_for_broker_auth || die "broker does not answer after the restart"
if $BIN/mosquitto_pub -h 127.0.0.1 -t e2e/anon -m x 2>/dev/null; then
    fail "anonymous publish succeeded with allow_anonymous false"
else
    ok "anonymous publish refused"
fi
roundtrip e2e/auth -u e2e -P secret && ok "authenticated round trip" || fail "authenticated round trip"
roundtrip e2e/tls -u e2e -P secret -p 8883 --cafile /etc/config/server.pem --insecure && ok "TLS round trip on 8883" || fail "TLS round trip on 8883"

log "password change + reload (SIGHUP) without restart"
pid_before=`broker_pid`
$BIN/mosquitto_passwd -b $ADDON_DIR/etc/passwd second pw2 >/dev/null || die "mosquitto_passwd second"
$RC reload >/dev/null || die "reload"
sleep 1
roundtrip e2e/second -u second -P pw2 && ok "new user works after reload" || fail "new user after reload"
[ "`broker_pid`" = "$pid_before" ] && ok "same broker process (pid $pid_before)" || fail "broker was restarted by reload"

# --- bridge (what the Bridges card writes): the broker bridges itself over a second listener ----
log "bridge block: local/# out to 127.0.0.1:1885 with prefix remote/"
cat >> $CONFIG <<EOL

listener 1885 127.0.0.1

connection e2e-self
address 127.0.0.1:1885
remote_username e2e
remote_password secret
remote_clientid e2e-bridge
cleansession true
bridge_protocol_version mqttv311
notifications false
try_private false
topic # out 0 local/ remote/
EOL
$BIN/mosquitto -c $CONFIG --test-config >/dev/null 2>&1 && ok "--test-config accepts the bridge config" || fail "--test-config rejects the bridge config"
$RC restart || die "restart with bridge"
wait_for_broker_auth || die "broker not running after the bridge restart"
sleep 2
out=`timeout 15 $BIN/mosquitto_sub -h 127.0.0.1 -u e2e -P secret -C 1 -W 10 -t remote/bridge/test & sleep 1; $BIN/mosquitto_pub -h 127.0.0.1 -u e2e -P secret -t local/bridge/test -m "over-the-bridge"; wait`
[ "$out" = "over-the-bridge" ] && ok "message crossed the bridge (local/ -> remote/)" || fail "bridge did not forward ('$out')"
grep -q "Connecting bridge e2e-self" /var/log/messages && ok "bridge connection logged" || fail "no bridge connection in syslog"

# --- update (the OpenCCU live path) --------------------------------------------------
log "update with the same package (update_script must exit 0 and restart the service)"
cp $CONFIG /tmp/config.before
install_addon
rc=$?
[ $rc -eq 0 ] || { cat /tmp/update_script.log; die "update_script exit code $rc, expected 0"; }
ok "update_script exit 0"
wait_for_broker_auth || die "broker not running after the update"
ok "broker running after the update"
cmp -s $CONFIG /tmp/config.before && ok "configuration preserved" || fail "configuration changed by the update"
[ -f $ADDON_DIR/etc/passwd ] && ok "password file preserved" || fail "password file lost"
[ -f $ADDON_DIR/var/mosquitto.db ] && ok "persistence database present" || echo "note: no mosquitto.db yet"

# --- migration from the 1.5.8 conf.d layout --------------------------------------------
log "migration of a 1.5.8 conf.d layout"
$RC stop >/dev/null
mkdir -p $ADDON_DIR/etc/conf.d $ADDON_DIR/lib
printf 'user root\ninclude_dir /usr/local/addons/mosquitto/etc/conf.d/\n' > $CONFIG
echo 'listener 1883 0.0.0.0' > $ADDON_DIR/etc/conf.d/listener-mqtt.conf
printf 'listener 1884\nprotocol websockets\n' > $ADDON_DIR/etc/conf.d/listener-ws.conf
printf 'listener 8883\nprotocol mqtt\n\ncertfile /etc/config/server.pem\nkeyfile /etc/config/server.pem\n' > $ADDON_DIR/etc/conf.d/listener-mqtts.conf.disabled
echo 'log_dest syslog' > $ADDON_DIR/etc/conf.d/log.conf
printf 'persistence true\npersistence_location /usr/local/addons/mosquitto/var/\n' > $ADDON_DIR/etc/conf.d/persistence.conf
touch $ADDON_DIR/lib/libcrypto.so.1.1 $ADDON_DIR/lib/libwebsockets.so.8
install_addon
rc=$?
[ $rc -eq 0 ] || { cat /tmp/update_script.log; die "update_script exit code $rc, expected 0"; }
[ -d $ADDON_DIR/etc/conf.d ] && fail "conf.d still there" || ok "conf.d folded (conf.d.old kept: `[ -d $ADDON_DIR/etc/conf.d.old ] && echo yes || echo no`)"
grep -q '^listener 1883 0.0.0.0' $CONFIG && grep -q '^listener 8883' $CONFIG && grep -q '^persistence true' $CONFIG \
    && ok "listeners and persistence in the folded mosquitto.conf" || { cat $CONFIG; fail "folded config incomplete"; }
grep -q '^include_dir' $CONFIG && fail "include_dir still in the folded config" || ok "include_dir removed"
[ -f $ADDON_DIR/lib/libcrypto.so.1.1 ] && fail "old libcrypto 1.1 survived" || ok "old libraries removed"
wait_for_broker 1883 || { cat $CONFIG; die "broker not running after the migration"; }
roundtrip e2e/migrated && ok "round trip on the migrated config (anonymous again, 1.5.8 had no auth)" || fail "round trip after migration"
roundtrip e2e/migrated-tls -p 8883 --cafile /etc/config/server.pem --insecure && ok "TLS listener from the .disabled fragment works" || fail "TLS after migration"

# --- self-update worker --------------------------------------------------------------------
log "self-update worker: same package from a local http server"
# the container has no /bin/install_addon, so this runs the worker's own
# extract-and-update_script path; --force because the package is not newer
busybox httpd -p 127.0.0.1:8081 -h /dist || die "busybox httpd"
MOSQUITTO_UPDATE_BASE_URL=http://127.0.0.1:8081 $ADDON_DIR/bin/mosquitto-update --force $VERSION_ADDON
rc=$?
echo "--- update.log"; cat /tmp/mosquitto-update/update.log
echo "--- state.json"; cat /tmp/mosquitto-update/state.json
[ $rc -eq 0 ] || die "mosquitto-update exit code $rc"
grep -q '"phase":"done"' /tmp/mosquitto-update/state.json || die "worker did not reach phase done"
grep -q '"error":""' /tmp/mosquitto-update/state.json || die "worker reported an error"
[ -f /usr/local/tmp/new_addon.tar.gz ] && fail "new_addon.tar.gz left behind"
ls -d /usr/local/tmp/tmp.* >/dev/null 2>&1 && fail "installer temp dir left behind"
ok "worker finished: download, checksum, install, restart"
wait_for_broker 1883 || die "broker not running after the self-update"
ok "broker running after the self-update"

# --- stop and uninstall --------------------------------------------------------------------
log "stop"
$RC stop
sleep 1
[ -z "`broker_pid`" ] && ok "broker stopped" || fail "broker still running after stop"
$RC status | grep -q '"running":false' && ok "status says stopped" || fail "status after stop"

log "uninstall"
$RC uninstall >/dev/null
[ -d $ADDON_DIR ] && fail "addon dir still there" || ok "addon dir removed"
[ -e $RC ] && fail "rc.d link still there" || ok "rc.d link removed"
[ -e $CONF_DIR/addons/www/mosquitto ] && fail "www link still there" || ok "www link removed"
grep -q '^mosquitto ' $CONF_DIR/hm_addons.cfg 2>/dev/null && fail "hm_addons.cfg still has the entry" || ok "WebUI button removed"

dump
echo ""
if [ $FAILED -eq 0 ]; then
    echo "### e2e: PASSED ($VERSION_ADDON)"
    exit 0
fi
echo "### e2e: FAILED ($VERSION_ADDON)"
exit 1
