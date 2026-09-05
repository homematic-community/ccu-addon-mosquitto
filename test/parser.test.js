// Unit test of the mosquitto.conf parser/serialiser in www/js/script.js
// (the settings page loads it in the browser, node loads the same file with
// `document` undefined and gets the model exported).
//
//   node test/parser.test.js

const assert = require('assert');
const path = require('path');

const model = require(path.join(__dirname, '..', 'addon_files', 'mosquitto', 'www', 'js', 'script.js'));
const { parse, load, serialise, state, PASSWD_FILE, ACL_FILE, PLUGIN_PASSWD, CCU_CERT, ADDON_CERT, ADDON_KEY } = model;

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('ok: ' + name);
    } catch (e) {
        console.log('FAIL: ' + name);
        console.log(e.stack || e.message);
        process.exitCode = 1;
    }
}

const DEFAULT = `# Mosquitto configuration - ccu-addon-mosquitto
user root

listener 1883

listener 1884
protocol websockets

allow_anonymous true

persistence true
persistence_location /usr/local/addons/mosquitto/var/
autosave_interval 1800

log_dest syslog
log_type error
log_type warning
log_type notice
log_type information
connection_messages true
`;

test('round trip of the default config is byte-identical', () => {
    load(DEFAULT);
    assert.strictEqual(serialise(), DEFAULT);
});

test('default config is parsed into the expected state', () => {
    load(DEFAULT);
    assert.strictEqual(state.listeners.length, 2);
    assert.deepStrictEqual(state.listeners.map(l => [l.port, l.protocol, l.tls]), [['1883', 'mqtt', false], ['1884', 'websockets', false]]);
    assert.strictEqual(state.allowAnonymous, true);
    assert.strictEqual(state.persistence, true);
    assert.strictEqual(state.autosaveInterval, '1800');
    assert.strictEqual(state.connectionMessages, true);
    assert.deepStrictEqual(state.logTypes, ['error', 'warning', 'notice', 'information']);
    assert.strictEqual(state.passwordFile, '');
    assert.strictEqual(state.aclFile, '');
});

test('adding a TLS listener writes cert lines from the CCU certificate', () => {
    load(DEFAULT);
    state.listeners.push({ type: 'listener', port: '8883', bind: '', protocol: 'mqtt', tls: true, certfile: '', keyfile: '', tls_version: '', max_connections: '', extras: [] });
    const out = serialise();
    assert.ok(out.includes('\nlistener 8883\ncertfile ' + CCU_CERT + '\nkeyfile ' + CCU_CERT + '\n'), out);
    // and it parses back
    load(out);
    assert.strictEqual(state.listeners.length, 3);
    assert.strictEqual(state.listeners[2].tls, true);
    assert.strictEqual(state.certSource, 'ccu');
});

test('cert source addon + tls_version apply to every TLS listener', () => {
    load(DEFAULT);
    state.listeners[0].tls = true;
    state.certSource = 'addon';
    state.tlsVersion = 'tlsv1.2';
    const out = serialise();
    assert.ok(out.includes('listener 1883\ncertfile ' + ADDON_CERT + '\nkeyfile ' + ADDON_KEY + '\ntls_version tlsv1.2\n'), out);
    load(out);
    assert.strictEqual(state.certSource, 'addon');
    assert.strictEqual(state.tlsVersion, 'tlsv1.2');
});

test('removing a listener drops its whole block including unknown sub-keys', () => {
    load(DEFAULT.replace('listener 1884\nprotocol websockets\n', 'listener 1884\nprotocol websockets\nmount_point ws/\nsocket_domain ipv4\n'));
    assert.deepStrictEqual(state.listeners[1].extras.filter(x => x.trim()), ['mount_point ws/', 'socket_domain ipv4']);
    state.listeners.splice(1, 1);
    const out = serialise();
    assert.ok(!out.includes('1884') && !out.includes('mount_point'), out);
    assert.ok(out.includes('listener 1883\n'), out);
});

test('unknown listener sub-keys stay inside their block', () => {
    load('listener 1883\nmax_qos 1\n\nlistener 1884\nprotocol websockets\nhttp_dir /tmp/www\n\nallow_anonymous true\n');
    state.listeners[0].bind = '127.0.0.1';
    const out = serialise();
    assert.strictEqual(out, 'listener 1883 127.0.0.1\nmax_qos 1\n\nlistener 1884\nprotocol websockets\nhttp_dir /tmp/www\n\nallow_anonymous true\n');
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

console.log(process.exitCode ? 'parser tests FAILED' : `parser tests passed (${passed})`);
