// Unit test of the mosquitto.conf parser/serialiser in www/js/script.js
// (the settings page loads it in the browser, node loads the same file with
// `document` undefined and gets the model exported).
//
//   node --test test/parser.test.js   (or npm run test:unit)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const model = require(path.join(__dirname, '..', 'addon_files', 'mosquitto', 'www', 'js', 'script.js'));
const { parse, load, serialise, state, newListener, newBridge, PASSWD_FILE, PLUGIN_PASSWD, CCU_CERT, ADDON_CERT, ADDON_KEY } = model;

// the shipped default configuration is the primary round-trip fixture
const DEFAULT = fs.readFileSync(path.join(__dirname, '..', 'addon_files', 'mosquitto', 'etc', 'mosquitto.conf.default'), 'utf8');

test('round trip of the shipped default config is byte-identical', () => {
    load(DEFAULT);
    assert.strictEqual(serialise(), DEFAULT);
});

test('default config is parsed into the expected state', () => {
    load(DEFAULT);
    assert.deepStrictEqual(state.listeners.map(l => [l.port, l.protocol, l.tls]),
        [['1883', 'mqtt', false], ['1884', 'websockets', false], ['8883', 'mqtt', true], ['8884', 'websockets', true]]);
    assert.strictEqual(state.certSource, 'ccu');
    assert.strictEqual(state.tlsVersion, '');
    assert.strictEqual(state.allowAnonymous, true);
    assert.strictEqual(state.persistence, true);
    assert.strictEqual(state.autosaveInterval, '1800');
    assert.strictEqual(state.connectionMessages, true);
    assert.deepStrictEqual(state.logTypes, ['error', 'warning', 'notice', 'information']);
    assert.strictEqual(state.passwordFile, '');
    assert.strictEqual(state.aclFile, '');
    assert.deepStrictEqual(state.bridges, []);
});

test('adding a TLS listener writes cert lines from the CCU certificate', () => {
    load(DEFAULT);
    const l = newListener('8885');
    l.tls = true;
    state.listeners.push(l);
    const out = serialise();
    assert.ok(out.endsWith('\nlistener 8885\ncertfile ' + CCU_CERT + '\nkeyfile ' + CCU_CERT + '\n'), out);
    load(out);
    assert.strictEqual(state.listeners.length, 5);
    assert.strictEqual(state.listeners[4].tls, true);
    assert.strictEqual(state.certSource, 'ccu');
});

test('cert source addon + tls_version apply to every TLS listener', () => {
    load(DEFAULT);
    state.certSource = 'addon';
    state.tlsVersion = 'tlsv1.2';
    const out = serialise();
    assert.ok(out.includes('listener 8883\ncertfile ' + ADDON_CERT + '\nkeyfile ' + ADDON_KEY + '\ntls_version tlsv1.2\n'), out);
    assert.ok(out.includes('listener 8884\nprotocol websockets\ncertfile ' + ADDON_CERT + '\nkeyfile ' + ADDON_KEY + '\ntls_version tlsv1.2\n'), out);
    assert.ok(!out.includes(CCU_CERT), 'no CCU cert left');
    load(out);
    assert.strictEqual(state.certSource, 'addon');
    assert.strictEqual(state.tlsVersion, 'tlsv1.2');
});

test('switching TLS off a listener drops its cert lines', () => {
    load(DEFAULT);
    state.listeners[2].tls = false;
    const out = serialise();
    assert.ok(out.includes('\nlistener 8883\n\nlistener 8884\n'), out);
});

test('removing a listener drops its whole block including unknown sub-keys', () => {
    load(DEFAULT.replace('listener 1884\nprotocol websockets\n', 'listener 1884\nprotocol websockets\nmount_point ws/\nsocket_domain ipv4\n'));
    assert.deepStrictEqual(state.listeners[1].extras.filter(x => x.trim()), ['mount_point ws/', 'socket_domain ipv4']);
    state.listeners.splice(1, 1);
    const out = serialise();
    assert.ok(!/^listener 1884/m.test(out) && !out.includes('mount_point') && !out.includes('socket_domain'), out);
    assert.ok(out.includes('listener 1883\n'), out);
    assert.strictEqual((out.match(/^listener /gm) || []).length, 3);
});

test('unknown listener sub-keys stay inside their block, file layout is kept', () => {
    const conf = 'listener 1883\nmax_qos 1\n\nlistener 1884\nprotocol websockets\nhttp_dir /tmp/www\n\nallow_anonymous true\n';
    load(conf);
    state.listeners[0].bind = '127.0.0.1';
    assert.strictEqual(serialise(), conf.replace('listener 1883', 'listener 1883 127.0.0.1'));
});

test('password file plugin block is written, parsed and removed', () => {
    load(DEFAULT);
    state.passwordFile = PASSWD_FILE;
    state.allowAnonymous = false;
    let out = serialise();
    assert.ok(out.includes('allow_anonymous false\n'), out);
    assert.ok(out.endsWith('\nplugin ' + PLUGIN_PASSWD + '\nplugin_opt_password_file ' + PASSWD_FILE + '\n'), out);
    load(out);
    assert.strictEqual(state.passwordFile, PASSWD_FILE);
    assert.strictEqual(state.allowAnonymous, false);
    state.passwordFile = '';
    out = serialise();
    assert.ok(!out.includes('plugin'), out);
    assert.ok(!out.endsWith('\n\n'), 'no trailing blank lines');
});

test('legacy password_file/acl_file directives are converted to plugin blocks', () => {
    load('listener 1883\nallow_anonymous false\npassword_file /tmp/pw\nacl_file /tmp/acl\n');
    assert.strictEqual(state.passwordFile, '/tmp/pw');
    assert.strictEqual(state.aclFile, '/tmp/acl');
    const out = serialise();
    assert.ok(!/^password_file/m.test(out) && !/^acl_file/m.test(out), out);
    assert.ok(out.includes('plugin_opt_password_file /tmp/pw\n'), out);
    assert.ok(out.includes('plugin_opt_acl_file /tmp/acl\n'), out);
});

test('foreign plugin blocks (dynsec) pass through untouched', () => {
    const conf = 'listener 1883\n\nplugin /usr/local/addons/mosquitto/lib/mosquitto_dynamic_security.so\nplugin_opt_config_file /usr/local/addons/mosquitto/etc/dynsec.json\n\nallow_anonymous false\n';
    load(conf);
    assert.strictEqual(state.passwordFile, '');
    assert.strictEqual(serialise(), conf);
});

test('log types: absent lines show the mosquitto default and are only written when changed', () => {
    load('listener 1883\nallow_anonymous true\n');
    assert.deepStrictEqual(state.logTypes, ['error', 'warning', 'notice', 'information']);
    assert.strictEqual(serialise(), 'listener 1883\nallow_anonymous true\n', 'absent defaults are not written');
    state.persistence = true;
    assert.strictEqual(serialise(), 'listener 1883\nallow_anonymous true\n\npersistence true\n', 'a changed value is appended');
    state.persistence = false;
    state.logTypes = ['error', 'debug'];
    state.logTypesExplicit = true;
    const out = serialise();
    assert.ok(out.includes('log_type error\nlog_type debug\n'), out);
});

test('duplicate managed keys collapse to one', () => {
    load('allow_anonymous true\nlistener 1883\nallow_anonymous false\n');
    assert.strictEqual(state.allowAnonymous, true, 'first occurrence wins in the model');
    const out = serialise();
    assert.strictEqual((out.match(/allow_anonymous/g) || []).length, 1);
});

test('a 1.5.8 migrated file with bind address and comments survives', () => {
    const conf = '# migrated\nuser root\nlog_dest syslog\n\n# listener-mqtt.conf\nlistener 1883 0.0.0.0\n\n# listener-mqtts.conf.disabled\nlistener 8883\nprotocol mqtt\n\ncertfile /etc/config/server.pem\nkeyfile /etc/config/server.pem\n\nallow_anonymous true\n';
    load(conf);
    assert.strictEqual(state.listeners[0].bind, '0.0.0.0');
    assert.strictEqual(state.listeners[1].tls, true);
    assert.strictEqual(state.certSource, 'ccu');
    const out = serialise();
    assert.ok(out.includes('# migrated\nuser root\nlog_dest syslog\n'), out);
    assert.ok(out.includes('listener 1883 0.0.0.0\n'), out);
    assert.ok(out.includes('listener 8883\ncertfile /etc/config/server.pem\nkeyfile /etc/config/server.pem\n'), out);
});

test('parse keeps CRLF files readable', () => {
    const items = parse('listener 1883\r\nallow_anonymous true\r\n');
    assert.strictEqual(items.length, 2);
});

test('persistence location: default parsed, USB stick path written in place, absent stays absent', () => {
    load(DEFAULT);
    assert.strictEqual(state.persistenceLocation, model.VAR_DIR);
    state.persistenceLocation = '/media/usb1/mosquitto/';
    let out = serialise();
    assert.ok(out.includes('persistence true\npersistence_location /media/usb1/mosquitto/\nautosave_interval 1800\n'), out);
    load(out);
    assert.strictEqual(state.persistenceLocation, '/media/usb1/mosquitto/');
    load('listener 1883\n');
    assert.strictEqual(state.persistenceLocation, '');
    assert.strictEqual(serialise(), 'listener 1883\n');
    state.persistenceLocation = '/tmp/p/';
    assert.strictEqual(serialise(), 'listener 1883\n\npersistence_location /tmp/p/\n');
});

// --- bridges (task 11) -------------------------------------------------------------

const BRIDGE = 'listener 1883\n\nconnection cloud\naddress broker.example.org:8883 backup.example.org:8883\nremote_username ccu\nremote_password secret\nremote_clientid ccu-bridge\ncleansession true\nbridge_protocol_version mqttv50\nbridge_cafile /etc/ssl/certs/ca.pem\nbridge_insecure true\nnotifications false\ntry_private false\ntopic # both 0\ntopic sensor/# out 1 local/ remote/\nrestart_timeout 10 60\n\nallow_anonymous true\n';

test('bridge block is parsed', () => {
    load(BRIDGE);
    assert.strictEqual(state.bridges.length, 1);
    const b = state.bridges[0];
    assert.strictEqual(b.name, 'cloud');
    assert.strictEqual(b.address, 'broker.example.org:8883 backup.example.org:8883');
    assert.strictEqual(b.remote_username, 'ccu');
    assert.strictEqual(b.remote_password, 'secret');
    assert.strictEqual(b.cleansession, 'true');
    assert.strictEqual(b.bridge_protocol_version, 'mqttv50');
    assert.strictEqual(b.bridge_cafile, '/etc/ssl/certs/ca.pem');
    assert.strictEqual(b.bridge_insecure, 'true');
    assert.strictEqual(b.notifications, 'false');
    assert.strictEqual(b.try_private, 'false');
    assert.deepStrictEqual(b.topics, ['# both 0', 'sensor/# out 1 local/ remote/']);
    assert.deepStrictEqual(b.extras.filter(x => x.trim()), ['restart_timeout 10 60']);
    assert.strictEqual(state.listeners.length, 1, 'connection ends the listener block');
    assert.strictEqual(state.allowAnonymous, true, 'a global key ends the bridge block');
});

test('bridge round trip is byte-identical', () => {
    load(BRIDGE);
    assert.strictEqual(serialise(), BRIDGE);
});

test('bridge edits are written, a new bridge is appended, removal drops the block', () => {
    load(BRIDGE);
    state.bridges[0].topics = ['# in 0'];
    state.bridges[0].remote_password = "it's secret";
    let out = serialise();
    assert.ok(out.includes("remote_password it's secret\n"), out);
    assert.ok(out.includes('try_private false\ntopic # in 0\nrestart_timeout 10 60\n'), out);
    assert.ok(!out.includes('sensor/#'), out);

    const b = newBridge('second');
    b.address = '10.0.0.2:1883';
    b.topics = ['x/# out 0'];
    state.bridges.push(b);
    out = serialise();
    assert.ok(out.endsWith('\nconnection second\naddress 10.0.0.2:1883\ntopic x/# out 0\n'), out);
    load(out);
    assert.strictEqual(state.bridges.length, 2);

    state.bridges.splice(0, 1);
    out = serialise();
    assert.ok(!out.includes('connection cloud') && !out.includes('restart_timeout'), out);
    assert.ok(out.includes('connection second'), out);
});

