// End-to-end test of the built x86_64 addon package (ROADMAP task 6, ported
// to node:test in task 16). Node.js is a test tool only, nothing of it ships
// in the addon.
//
//   npm run test:e2e            (needs docker and dist/mosquitto-x86_64-*.tar.gz)
//   KEEP=1 npm run test:e2e     keeps the container for a look afterwards
//
// A Debian container gets what the CCU has (test/lib/container.js), then
// OpenCCU's /bin/install_addon is replayed for a fresh install and an
// update. Broker checks use the mqtt npm package from the host through
// published ports; the bundled clients are exercised once through docker
// exec. The tests run in file order and build on each other.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { container, connect, roundtrip, refused, publish, sleep, waitFor, ADDON, BIN, CONFIG, RC } = require('./lib/container');

const box = container('mosquitto-e2e', { mqtt: 18883, ws: 18884, mqtts: 18885, wss: 18886 });
const { sh, shOk, U } = box;
const installAddon = () => box.installAddon();
const brokerPid = () => box.brokerPid();
const waitForBroker = opts => box.waitForBroker(opts);
const AUTH = { username: 'e2e', password: 'secret' };

before(() => box.start());
after(() => box.stop());

// --- fresh install and start -------------------------------------------------------

test('fresh install: update_script exits 10, links, WebUI button, info', () => {
    const r = installAddon();
    assert.equal(r.code, 10, `update_script exit ${r.code}, expected 10\n${r.out}`);
    shOk(`test -x ${RC} && test -L /usr/local/etc/config/addons/www/mosquitto && test -f ${CONFIG}`);
    assert.match(shOk('cat /usr/local/etc/config/hm_addons.cfg'), /^mosquitto \{CONFIG_URL \/addons\/mosquitto\/settings.cgi/);
    const info = shOk(`${RC} info`);
    assert.match(info, /^Name: Mosquitto$/m);
    assert.match(info, /^Version: \d+\.\d+\.\d+\+\d+$/m);
    assert.match(info, /^Config-Url: \/addons\/mosquitto\/settings.cgi$/m);
});

test('start: broker answers, runs from /, logs its start', async () => {
    shOk(`${RC} start`);
    await waitForBroker();
    assert.match(shOk(`${RC} status`), /"running":true/);
    assert.equal(shOk(`readlink /proc/${brokerPid()}/cwd`).trim(), '/', 'working directory of the broker');
    assert.match(box.syslog(), /mosquitto version \d+\.\d+\.\d+ starting/);
});

test('pub/sub round trip on 1883, also with the bundled clients', async () => {
    assert.match(await roundtrip(U.mqtt), /^hello-/);
    const out = shOk(`(${BIN}/mosquitto_sub -h 127.0.0.1 -C 1 -W 10 -t e2e/clients &); sleep 1; ${BIN}/mosquitto_pub -h 127.0.0.1 -t e2e/clients -m from-the-bundled-clients; sleep 1`);
    assert.match(out, /from-the-bundled-clients/);
});

test('websockets listener on 1884', async () => {
    assert.match(await roundtrip(U.ws), /^hello-/);
});

test('TLS listeners of the default config with the CCU certificate (8883 mqtts, 8884 wss)', async () => {
    assert.match(shOk(`grep -c '^listener' ${CONFIG}`), /^4/);
    assert.match(await roundtrip(U.mqtts), /^hello-/);
    assert.match(await roundtrip(U.wss), /^hello-/);
});

// --- password file: what the settings page writes --------------------------------

test('password file plugin: anonymous and wrong password refused, right one accepted', async () => {
    shOk(`printf '\nplugin ${ADDON}/lib/mosquitto_password_file.so\nplugin_opt_password_file ${ADDON}/etc/passwd\n' >> ${CONFIG} && sed -i 's/^allow_anonymous true/allow_anonymous false/' ${CONFIG}`);
    shOk(`${BIN}/mosquitto_passwd -c -b ${ADDON}/etc/passwd e2e secret`);
    shOk(`${BIN}/mosquitto -c ${CONFIG} --test-config`);
    shOk(`${RC} restart`);
    await waitForBroker(AUTH);
    assert.match(await refused(U.mqtt), /Not authorized/);
    assert.match(await refused(U.mqtt, { username: 'e2e', password: 'wrong' }), /Not authorized/);
    assert.match(await refused(U.mqtt, { username: 'nobody', password: 'secret' }), /Not authorized/);
    assert.match(await roundtrip(U.mqtt, AUTH), /^hello-/);
    assert.match(await roundtrip(U.mqtts, AUTH), /^hello-/, 'TLS plus password');
    assert.match(await roundtrip(U.ws, AUTH), /^hello-/, 'websockets plus password');
});

test('user added, password changed and user deleted take effect on reload without a restart', async () => {
    const pid = brokerPid();
    shOk(`${BIN}/mosquitto_passwd -b ${ADDON}/etc/passwd second pw2 && ${RC} reload`);
    await sleep(1000);
    assert.match(await roundtrip(U.mqtt, { username: 'second', password: 'pw2' }), /^hello-/, 'new user after reload');

    shOk(`${BIN}/mosquitto_passwd -b ${ADDON}/etc/passwd second pw3 && ${RC} reload`);
    await sleep(1000);
    assert.match(await refused(U.mqtt, { username: 'second', password: 'pw2' }), /Not authorized/, 'old password after change');
    assert.match(await roundtrip(U.mqtt, { username: 'second', password: 'pw3' }), /^hello-/, 'new password after change');

    shOk(`${BIN}/mosquitto_passwd -D ${ADDON}/etc/passwd second && ${RC} reload`);
    await sleep(1000);
    assert.match(await refused(U.mqtt, { username: 'second', password: 'pw3' }), /Not authorized/, 'deleted user');
    assert.match(await roundtrip(U.mqtt, AUTH), /^hello-/, 'the other user still works');
    assert.equal(brokerPid(), pid, 'same broker process, no restart');
    // the file holds salted hashes, never the passwords
    const passwd = shOk(`cat ${ADDON}/etc/passwd`);
    assert.match(passwd, /^e2e:\$7\$/m);
    assert.doesNotMatch(passwd, /secret/);
});

// --- bridge: what the Bridges card writes -----------------------------------------------

test('bridge block: the broker bridges local/ to itself over a second listener as remote/', async () => {
    shOk(`printf '\nlistener 1885 127.0.0.1\n\nconnection e2e-self\naddress 127.0.0.1:1885\nremote_username e2e\nremote_password secret\nremote_clientid e2e-bridge\ncleansession true\nbridge_protocol_version mqttv311\nnotifications false\ntry_private false\ntopic # out 0 local/ remote/\n' >> ${CONFIG}`);
    shOk(`${BIN}/mosquitto -c ${CONFIG} --test-config`);
    shOk(`${RC} restart`);
    await waitForBroker(AUTH);
    await waitFor(() => /Connecting bridge e2e-self/.test(box.syslog()), 'the bridge connection in the syslog', 15000);
    await sleep(1000);
    const got = await roundtrip(U.mqtt, AUTH, 'local/bridge/test', { receiveTopic: 'remote/bridge/test' });
    assert.match(got, /^hello-/);
});

// --- persistence location: a directory on a USB stick on the CCU ----------------------------

test('persistence_location elsewhere: directory created by the service, retained message survives a restart', async () => {
    shOk(`sed -i 's|^persistence_location .*|persistence_location /usr/local/tmp/persist-test/|' ${CONFIG} && ${RC} restart`);
    await waitForBroker(AUTH);
    shOk('test -d /usr/local/tmp/persist-test');
    await publish(U.mqtt, AUTH, 'e2e/retained', 'keep-me', { retain: true });
    shOk(`${RC} restart`);
    await waitForBroker(AUTH);
    shOk('test -s /usr/local/tmp/persist-test/mosquitto.db');
    const sub = await connect(U.mqtt, AUTH);
    const got = await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('retained message not delivered')), 5000);
        sub.on('message', (t, p) => resolve(p.toString()));
        sub.subscribe('e2e/retained');
    });
    sub.end(true);
    assert.equal(got, 'keep-me');
    shOk(`sed -i 's|^persistence_location .*|persistence_location ${ADDON}/var/|' ${CONFIG} && ${RC} restart`);
    await waitForBroker(AUTH);
});

// --- update, migration, self-update ------------------------------------------------------

test('update with the same package: exit 0, service restarted, configuration and password file preserved', async () => {
    const before = shOk(`cat ${CONFIG}`);
    const r = installAddon();
    assert.equal(r.code, 0, `update_script exit ${r.code}, expected 0\n${r.out}`);
    await waitForBroker(AUTH);
    assert.equal(shOk(`cat ${CONFIG}`), before, 'configuration preserved');
    shOk(`test -f ${ADDON}/etc/passwd && test -f ${ADDON}/var/mosquitto.db`);
});

test('migration of a 1.5.8 conf.d layout: folded, TLS fragment works, anonymous stays allowed, old libraries gone', async () => {
    shOk(`${RC} stop; mkdir -p ${ADDON}/etc/conf.d ${ADDON}/lib
printf 'user root\ninclude_dir ${ADDON}/etc/conf.d/\n' > ${CONFIG}
echo 'listener 1883 0.0.0.0' > ${ADDON}/etc/conf.d/listener-mqtt.conf
printf 'listener 1884\nprotocol websockets\n' > ${ADDON}/etc/conf.d/listener-ws.conf
printf 'listener 8883\nprotocol mqtt\n\ncertfile /etc/config/server.pem\nkeyfile /etc/config/server.pem\n' > ${ADDON}/etc/conf.d/listener-mqtts.conf.disabled
echo 'log_dest syslog' > ${ADDON}/etc/conf.d/log.conf
printf 'persistence true\npersistence_location ${ADDON}/var/\n' > ${ADDON}/etc/conf.d/persistence.conf
touch ${ADDON}/lib/libcrypto.so.1.1 ${ADDON}/lib/libwebsockets.so.8`);
    const r = installAddon();
    assert.equal(r.code, 0, `update_script exit ${r.code}\n${r.out}`);
    shOk(`test ! -d ${ADDON}/etc/conf.d && test -d ${ADDON}/etc/conf.d.old && test ! -f ${ADDON}/lib/libcrypto.so.1.1`);
    const conf = shOk(`cat ${CONFIG}`);
    assert.match(conf, /^listener 1883 0\.0\.0\.0$/m);
    assert.match(conf, /^listener 8883$/m);
    assert.match(conf, /^persistence true$/m);
    assert.match(conf, /^allow_anonymous true$/m, 'Mosquitto 2.x default would lock everyone out');
    assert.doesNotMatch(conf, /^include_dir/m);
    await waitForBroker();
    assert.match(await roundtrip(U.mqtt), /^hello-/, 'anonymous again, 1.5.8 had no auth');
    assert.match(await roundtrip(U.mqtts), /^hello-/, 'TLS listener from the .disabled fragment');
});

test('self-update worker: download, checksum, install, restart from a local http server', async () => {
    shOk('busybox httpd -p 127.0.0.1:8081 -h /dist');
    // no /bin/install_addon in the container: the worker unpacks and runs update_script itself;
    // --force because the package is not newer than the installed one
    const version = shOk(`. ${ADDON}/versions; echo $VERSION_ADDON`).trim();
    const r = sh(`MOSQUITTO_UPDATE_BASE_URL=http://127.0.0.1:8081 ${ADDON}/bin/mosquitto-update --force ${version}; rc=$?; cat /tmp/mosquitto-update/update.log; cat /tmp/mosquitto-update/state.json; exit $rc`);
    assert.equal(r.code, 0, `worker exit ${r.code}\n${r.out}`);
    assert.match(r.out, /"phase":"done"/);
    assert.match(r.out, /"error":""/);
    shOk('test ! -f /usr/local/tmp/new_addon.tar.gz && ! ls -d /usr/local/tmp/tmp.* >/dev/null 2>&1');
    await waitForBroker();
});

// --- stop and uninstall ----------------------------------------------------------------------

test('stop', async () => {
    shOk(`${RC} stop`);
    await sleep(1000);
    assert.equal(brokerPid(), '', 'no broker process');
    assert.match(sh(`${RC} status`).out, /"running":false/);
});

test('uninstall removes the tree, the links and the WebUI button', () => {
    shOk(`${RC} uninstall`);
    shOk(`test ! -d ${ADDON} && test ! -e ${RC} && test ! -e /usr/local/etc/config/addons/www/mosquitto`);
    assert.doesNotMatch(sh('cat /usr/local/etc/config/hm_addons.cfg').out, /^mosquitto /m);
});
