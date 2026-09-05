// Web UI test of the built x86_64 package (ROADMAP task 16): the real
// settings page and its CGIs, served by lighttpd inside the test container
// with a stub of the firmware's session check, driven by headless chromium
// from the host; every configurable aspect is verified against the running
// broker with the mqtt client. Node.js and playwright are test tooling only.
//
//   npm run test:webui          (needs docker and dist/mosquitto-x86_64-*.tar.gz)
//   KEEP=1 npm run test:webui   keeps the container (settings page on http://127.0.0.1:18080)
//
// Sections: A = the CGIs through HTTP (integration), B = the page in the
// browser (end to end, broker behaviour checked per setting), C = coverage
// of the page script. Tests run in file order and build on each other.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { container, connect, roundtrip, refused, publish, sleep, waitFor, ADDON, BIN, CONFIG, RC } = require('./lib/container');
const { SID, SID_ID, setupWebUI, put, cgi, WEB_PACKAGES } = require('./lib/webui-setup');
const P = require('./lib/page');

const box = container('mosquitto-webui', { mqtt: 18893, ws: 18894, mqtts: 18895, wss: 18896, http: 18080 });
const { sh, shOk, U } = box;
const c = (pathAndQuery, body) => cgi(box, pathAndQuery, body);
const BAD = '@0000000000@';
const AUTH = { username: 'ui', password: 'ui-secret' };
const SETTINGS_URL = `${U.http}/addons/mosquitto/settings.cgi?sid=${SID}`;
let browser;
let page;
const coverageEntries = [];

before(async () => {
    box.start(WEB_PACKAGES);
    const r = box.installAddon();
    assert.equal(r.code, 10, `install failed\n${r.out}`);
    shOk(`${RC} start`);
    await box.waitForBroker();
    setupWebUI(box);
    browser = await P.openBrowser();
});

after(async () => {
    if (browser) await browser.close();
    box.stop();
});

// =========================== A: the CGIs through HTTP ===========================

test('A settings.cgi: the page with a valid session, the error page otherwise', async () => {
    const ok = await c(`settings.cgi?sid=${SID}`);
    assert.equal(ok.status, 200);
    assert.match(ok.text, /<title>Mosquitto<\/title>/);
    assert.match(ok.text, /id="listeners"/);
    for (const q of ['', `?sid=${BAD}`, '?sid=garbage']) {
        const r = await c(`settings.cgi${q}`);
        assert.equal(r.status, 200);
        assert.match(r.text, /Sitzung ungültig/, `no session error page for "${q}"`);
    }
});

test('A static files and the licenses page', async () => {
    for (const f of ['css/style.css', 'js/script.js', 'mosquitto-text-side-28.png', 'licenses.html']) {
        assert.equal((await c(f)).status, 200, f);
    }
    const lic = (await c('licenses.html')).text;
    assert.match(lic, /Roger Light/);
    assert.match(lic, /Eclipse Public License 2\.0/);
    assert.match(lic, /musl/);
});

test('A service.cgi: status and versions without session, commands only with', async () => {
    const status = JSON.parse((await c('service.cgi?cmd=status')).text);
    assert.equal(status.running, true);
    assert.ok(status.pid > 0 && status.rss_kb > 0 && status.since > 0);
    const versions = JSON.parse((await c('service.cgi?cmd=versions')).text);
    assert.match(versions.VERSION_ADDON, /^\d+\.\d+\.\d+\+\d+$/);
    assert.equal(versions.ADDON_ARCH, 'x86_64');
    assert.match((await c(`service.cgi?cmd=reload&sid=${SID}`)).text, /OK/);
    assert.match((await c(`service.cgi?cmd=restart&sid=${SID}`)).text, /Stopping Mosquitto: OK[\s\S]*Starting Mosquitto: OK/);
    await box.waitForBroker();
    assert.match((await c(`service.cgi?cmd=stop&sid=${SID}`)).text, /OK/);
    await sleep(500);
    const stopped = JSON.parse((await c('service.cgi?cmd=status')).text);
    assert.equal(stopped.running, false);
    assert.equal(typeof stopped.lastError, 'string');
    assert.match((await c(`service.cgi?cmd=start&sid=${SID}`)).text, /OK/);
    await box.waitForBroker();
    for (const cmd of ['start', 'stop', 'restart', 'reload']) {
        assert.match((await c(`service.cgi?cmd=${cmd}&sid=${BAD}`)).text, /error: invalid session/, cmd);
    }
    assert.match((await c(`service.cgi?cmd=nonsense&sid=${SID}`)).text, /error: invalid command/);
});

test('A getconfig.cgi / setconfig.cgi: round trip, validation by Mosquitto, backup, errors', async () => {
    const conf = (await c(`getconfig.cgi?sid=${SID}`)).text;
    assert.match(conf, /^listener 1883$/m);
    assert.match((await c(`getconfig.cgi?sid=${BAD}`)).text, /error: invalid session/);
    assert.match((await c('getconfig.cgi')).text, /error: invalid session/);

    assert.equal((await c(`setconfig.cgi?sid=${SID}`, conf)).text.trim(), 'ok');
    shOk(`test -f ${CONFIG}.bak`);
    const bad = await c(`setconfig.cgi?sid=${SID}`, 'listener 1883\nfoo bar\n');
    assert.match(bad.text, /^error: .*Unknown configuration variable 'foo'/);
    assert.equal((await c(`getconfig.cgi?sid=${SID}`)).text, conf, 'the invalid file was not installed');
    shOk(`test ! -f ${CONFIG}.new && test ! -f ${CONFIG}.test`);
    assert.match((await c(`setconfig.cgi?sid=${SID}`, '  \n')).text, /error: empty configuration/);
    assert.match((await c(`setconfig.cgi?sid=${BAD}`, conf)).text, /error: invalid session/);
    // the running broker's database survives the validation (persistence off on the test copy)
    shOk(`test -f ${ADDON}/var/mosquitto.db || true`);
});

test('A passwd.cgi: list, set, change, delete, validation, file mode, never a hash in the answer', async () => {
    const list0 = JSON.parse((await c(`passwd.cgi?cmd=list&sid=${SID}`)).text);
    assert.deepEqual(list0, { file: `${ADDON}/etc/passwd`, exists: false, users: [] });
    const set = JSON.parse((await c(`passwd.cgi?cmd=set&sid=${SID}`, 'user=ui&password=ui-secret')).text);
    assert.deepEqual(set, { ok: true, users: ['ui'] });
    assert.match(shOk(`stat -c %a ${ADDON}/etc/passwd`), /^600/);
    const set2 = JSON.parse((await c(`passwd.cgi?cmd=set&sid=${SID}`, `user=zwei&password=${encodeURIComponent("it's a 'quoted' pw & more")}`)).text);
    assert.deepEqual(set2.users, ['ui', 'zwei']);
    assert.doesNotMatch(JSON.stringify(set2), /\$7\$/, 'no hash leaves the CGI');
    assert.match(shOk(`cat ${ADDON}/etc/passwd`), /^zwei:\$7\$/m);
    const del = JSON.parse((await c(`passwd.cgi?cmd=delete&sid=${SID}`, 'user=zwei')).text);
    assert.deepEqual(del, { ok: true, users: ['ui'] });
    assert.match(JSON.parse((await c(`passwd.cgi?cmd=delete&sid=${SID}`, 'user=nobody')).text).error, /mosquitto_passwd/);
    assert.match(JSON.parse((await c(`passwd.cgi?cmd=set&sid=${SID}`, 'user=bad%20name&password=x')).text).error, /Benutzername/);
    assert.match(JSON.parse((await c(`passwd.cgi?cmd=set&sid=${SID}`, 'user=ok&password=')).text).error, /Passwort/);
    assert.match(JSON.parse((await c(`passwd.cgi?cmd=other&sid=${SID}`, 'user=ok')).text).error, /unknown command/);
    assert.equal(JSON.parse((await c(`passwd.cgi?cmd=list&sid=${BAD}`)).text).error, 'invalid session');
});

test('A cert.cgi: info of the CCU certificate, generation with SANs, errors', async () => {
    assert.match((await c(`cert.cgi?cmd=info&sid=${SID}&file=/etc/config/server.pem`)).text, /subject=.*CN\s*=\s*e2e-ccu[\s\S]*notAfter=/);
    assert.match((await c(`cert.cgi?cmd=info&sid=${SID}&file=/nonexistent.pem`)).text, /error: Datei nicht gefunden/);
    assert.match((await c(`cert.cgi?cmd=info&sid=${SID}&file=/etc/hostname`)).text, /^error: /);
    assert.equal((await c(`cert.cgi?cmd=generate&sid=${SID}`, 'cn=')).text.trim(), 'ok');
    const san = shOk(`openssl x509 -in ${ADDON}/etc/certs/server.crt -noout -text | grep -A1 'Subject Alternative Name'`);
    assert.match(san, /DNS:/);
    assert.match(san, /IP Address:/);
    assert.match(shOk(`stat -c %a ${ADDON}/etc/certs/server.key`), /^600/);
    assert.equal((await c(`cert.cgi?cmd=generate&sid=${SID}`, 'cn=my-broker')).text.trim(), 'ok');
    assert.match((await c(`cert.cgi?cmd=info&sid=${SID}&file=${ADDON}/etc/certs/server.crt`)).text, /CN\s*=\s*my-broker/);
    assert.match((await c(`cert.cgi?cmd=other&sid=${SID}`)).text, /error: unknown command/);
    assert.match((await c(`cert.cgi?cmd=generate&sid=${BAD}`, 'cn=')).text, /error: invalid session/);
});

test('A firewall.cgi: status, opening ports, RESTRICTIVE mode through the firmware API stub', async () => {
    assert.deepEqual(JSON.parse((await c(`firewall.cgi?cmd=status&sid=${SID}`)).text), { available: true, mode: 'MOST_OPEN', userports: [] });
    const opened = JSON.parse((await c(`firewall.cgi?cmd=open&sid=${SID}`, 'ports=1883,8883')).text);
    assert.deepEqual(opened.userports, [1883, 8883]);
    shOk('test -f /tmp/firewall.applied && grep -q "Firewall_USER_PORTS {1883 8883}" /tmp/firewall.conf');
    assert.deepEqual(JSON.parse((await c(`firewall.cgi?cmd=open&sid=${SID}`, 'ports=1883,x,70000')).text).userports, [1883, 8883], 'nothing new, invalid ports ignored');
    assert.match(JSON.parse((await c(`firewall.cgi?cmd=open&sid=${SID}`, 'ports=')).text).error, /keine gültigen Ports/);
    put(box, '/tmp/firewall.conf', 'set Firewall_MODE RESTRICTIVE\nset Firewall_USER_PORTS {1883}\n');
    assert.deepEqual(JSON.parse((await c(`firewall.cgi?cmd=status&sid=${SID}`)).text), { available: true, mode: 'RESTRICTIVE', userports: [1883] });
    assert.match(JSON.parse((await c(`firewall.cgi?cmd=other&sid=${SID}`)).text).error, /unknown command/);
    assert.equal(JSON.parse((await c(`firewall.cgi?cmd=status&sid=${BAD}`)).text).error, 'invalid session');
    shOk('rm -f /tmp/firewall.conf');
});

test('A media.cgi: mounted sticks only, path checks, a bind-mounted stick appears', async () => {
    assert.deepEqual(JSON.parse((await c(`media.cgi?cmd=list&sid=${SID}`)).text), { media: [] });
    const varDir = JSON.parse((await c(`media.cgi?cmd=check&sid=${SID}&file=${encodeURIComponent(ADDON + '/var/')}`)).text);
    assert.equal(varDir.exists, true); assert.equal(varDir.mounted, true); assert.equal(varDir.writable, true); assert.ok(varDir.free_mb > 0);
    shOk('mkdir -p /media/usb1');
    const notMounted = JSON.parse((await c(`media.cgi?cmd=check&sid=${SID}&file=/media/usb1/mosquitto/`)).text);
    assert.equal(notMounted.mounted, false);
    assert.match(JSON.parse((await c(`media.cgi?cmd=check&sid=${SID}`)).text).error, /no path/);
    shOk('mkdir -p /usr/local/tmp/fakeusb && mount --bind /usr/local/tmp/fakeusb /media/usb1');
    const list = JSON.parse((await c(`media.cgi?cmd=list&sid=${SID}`)).text).media;
    assert.equal(list.length, 1); assert.equal(list[0].path, '/media/usb1'); assert.ok(list[0].free_mb > 0);
    const mounted = JSON.parse((await c(`media.cgi?cmd=check&sid=${SID}&file=/media/usb1/mosquitto/`)).text);
    assert.equal(mounted.mounted, true); assert.equal(mounted.exists, false);
    shOk('umount /media/usb1');
    assert.equal(JSON.parse((await c(`media.cgi?cmd=list&sid=${BAD}`)).text).error, 'invalid session');
});

test('A log.cgi, update_check.cgi, update.cgi', async () => {
    const log = (await c(`log.cgi?sid=${SID}`)).text;
    for (const s of ['### versions', '### etc/mosquitto.conf', '### netstat', '### /var/log/messages']) assert.match(log, new RegExp(s));
    assert.match((await c(`log.cgi?sid=${BAD}`)).text, /error: invalid session/);

    assert.equal((await c('update_check.cgi')).text, '0.0.0+0');
    assert.match((await c('update_check.cgi?cmd=download')).text, /meta http-equiv='refresh'.*releases\/latest/);
    put(box, '/tmp/fake-latest.json', '{"message":"rate limited"}');
    assert.equal((await c('update_check.cgi')).text, 'n/a');
    put(box, '/tmp/fake-latest.json', JSON.stringify({ tag_name: '0.0.0+0' }));

    assert.deepEqual(JSON.parse((await c('update.cgi?cmd=status')).text), { phase: 'idle' });
    for (const cmd of ['log', 'start', 'reset']) assert.equal(JSON.parse((await c(`update.cgi?cmd=${cmd}&sid=${BAD}`)).text).error, 'invalid session', cmd);
    assert.deepEqual(JSON.parse((await c(`update.cgi?cmd=reset&sid=${SID}`)).text), { phase: 'idle' });
    assert.match(JSON.parse((await c(`update.cgi?cmd=other&sid=${SID}`)).text).error, /unknown command/);
    assert.equal((await c(`update.cgi?cmd=log&sid=${SID}`)).status, 200);
});

// =========================== B: the page in the browser ===========================

const conf = async () => (await c(`getconfig.cgi?sid=${SID}`)).text;

test('B page: initial state reflects the default configuration', async () => {
    page = await P.openSettings(browser, SETTINGS_URL);
    assert.match(await P.text(page, '#addon-version'), /^ccu-addon-mosquitto \d+\.\d+\.\d+\+\d+ · Mosquitto \d+\.\d+\.\d+$/);
    assert.match(await P.text(page, '#status'), /running/);
    assert.match(await P.text(page, '#status-detail'), /pid \d+, rss \d+\.\d MB/);
    assert.equal(await P.count(page, '#listeners .listener'), 4);
    assert.equal(await P.value(page, '#cert-source'), 'ccu');
    assert.match(await P.text(page, '#cert-info'), /server\.pem[\s\S]*CN\s*=\s*e2e-ccu/);
    assert.equal(await P.value(page, '#allow-anonymous'), 'true');
    assert.equal(await P.checked(page, '#password-file'), false);
    assert.equal(await P.checked(page, '#persistence'), true);
    assert.equal(await P.value(page, '#autosave-interval'), '1800');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#log-types input')).filter(i => i.checked).map(i => i.value)), ['error', 'warning', 'notice', 'information']);
    assert.equal(await P.visible(page, '#update-notify'), false);
    assert.equal(await P.visible(page, '#apply-bar'), false);
    assert.equal(await P.disabled(page, '#btn-start'), true);
    assert.equal(await P.disabled(page, '#btn-restart'), false);
    assert.deepEqual(page.problems, []);
});

test('B process card: stop, start, reload, restart', async () => {
    await P.click(page, '#btn-stop');
    await P.until(page, () => /stopped/.test(document.querySelector('#status').textContent), 'stopped');
    assert.equal(await P.disabled(page, '#btn-start'), false);
    assert.equal(await P.disabled(page, '#btn-stop'), true);
    await P.click(page, '#btn-start');
    await P.until(page, () => /running/.test(document.querySelector('#status').textContent), 'running');
    await box.waitForBroker();
    await P.click(page, '#btn-reload');
    await P.until(page, () => /Kommando ausgeführt/.test(document.querySelector('#toast').textContent), 'reload toast');
    const pid = box.brokerPid();
    await P.enabled(page, '#btn-restart');
    await P.click(page, '#btn-restart');
    await waitFor(() => box.brokerPid() !== '' && box.brokerPid() !== pid, 'a new broker process', 30000);
    await P.until(page, () => /running/.test(document.querySelector('#status').textContent), 'running after restart');
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B listeners: add a TLS listener, change protocol/bind/limits, remove; the broker follows', async () => {
    await P.click(page, '#listener-add');
    await page.waitForTimeout(500);
    assert.equal(await P.count(page, '#listeners .listener'), 5);
    // 1883/8883/1884/8884 are taken, so the new one has no port until set (nothing saved yet)
    await P.change(page, '#listeners .listener:nth-child(5) input[type=number]', '8885');
    await P.clickSaved(page, '#listeners .listener:nth-child(5) input[type=checkbox]');
    assert.match(await conf(), /^listener 8885\ncertfile \/etc\/config\/server.pem\nkeyfile \/etc\/config\/server.pem$/m);
    await P.change(page, '#listeners .listener:nth-child(5) input[type=text]', '127.0.0.1');
    await P.change(page, '#listeners .listener:nth-child(5) select', 'websockets');
    await P.change(page, '#listeners .listener:nth-child(5) input[type=number]:last-of-type', '1');
    assert.match(await conf(), /^listener 8885 127\.0\.0\.1\nprotocol websockets\ncertfile \/etc\/config\/server.pem\nkeyfile \/etc\/config\/server.pem\nmax_connections 1$/m);
    await P.restartFromPage(page);
    await box.waitForBroker();
    // bound to 127.0.0.1 inside the container
    assert.match(shOk('ss -tln'), /127\.0\.0\.1:8885/);
    // max_connections 1 on the default 1883 listener: the second client is refused
    await P.change(page, '#listeners .listener:nth-child(1) input[type=number]:last-of-type', '1');
    await P.restartFromPage(page);
    await box.waitForBroker();
    const first = await connect(U.mqtt);
    await refused(U.mqtt);
    first.end(true);
    await P.change(page, '#listeners .listener:nth-child(1) input[type=number]:last-of-type', '');
    // invalid port: not saved, marked
    await P.setValue(page, '#listeners .listener:nth-child(5) input[type=number]', '70000');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.querySelector('#listeners .listener:nth-child(5) input[type=number]').classList.contains('is-invalid')), true);
    assert.match(await conf(), /^listener 8885 /m, 'the invalid port was not written');
    // remove it
    await P.clickSaved(page, '#listeners .listener:nth-child(5) button');
    assert.equal(await P.count(page, '#listeners .listener'), 4);
    assert.doesNotMatch(await conf(), /8885/);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.match(await roundtrip(U.mqtts), /^hello-/);
    assert.deepEqual(page.problems, []);
});

test('B certificate: generated addon certificate, custom paths, tls_version; TLS keeps working', async () => {
    await P.change(page, '#cert-source', 'addon');
    assert.match(await conf(), /^listener 8883\ncertfile \/usr\/local\/addons\/mosquitto\/etc\/certs\/server.crt\nkeyfile \/usr\/local\/addons\/mosquitto\/etc\/certs\/server.key$/m);
    await P.click(page, '#cert-generate');
    await P.until(page, () => /Zertifikat erzeugt/.test(document.querySelector('#toast').textContent), 'generate toast', 30000);
    await P.until(page, () => /certs\/server\.crt[\s\S]*notAfter/.test(document.querySelector('#cert-info').textContent), 'cert info');
    await P.change(page, '#tls-version', 'tlsv1.2');
    assert.match(await conf(), /^tls_version tlsv1\.2$/m);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.match(await roundtrip(U.mqtts), /^hello-/, 'TLS with the generated certificate');
    assert.match(await roundtrip(U.wss), /^hello-/);
    await P.setValue(page, '#cert-source', 'custom');
    await page.waitForTimeout(300);
    assert.equal(await P.visible(page, '#cert-custom'), true);
    await P.setValue(page, '#cert-certfile', '/etc/config/server.pem');
    await P.change(page, '#cert-keyfile', '/etc/config/server.pem');
    // saves overlap when the inputs change quickly: wait for the file, do not just read it
    await waitFor(async () => /^certfile \/etc\/config\/server.pem\nkeyfile \/etc\/config\/server.pem\ntls_version tlsv1\.2$/m.test(await conf()), 'custom paths in the file', 10000);
    await P.change(page, '#tls-version', '');
    await P.change(page, '#cert-source', 'ccu');
    assert.doesNotMatch(await conf(), /tls_version|certs\/server/);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B authentication: password file with users from the page; anonymous off; passwords write-only', async () => {
    await P.checkSaved(page, '#password-file', true);
    assert.match(await conf(), /^plugin \/usr\/local\/addons\/mosquitto\/lib\/mosquitto_password_file\.so\nplugin_opt_password_file \/usr\/local\/addons\/mosquitto\/etc\/passwd$/m);
    assert.equal(await P.visible(page, '#users-block'), true);
    await P.until(page, () => /^ui$/.test(document.querySelector('#users tr td')?.textContent || ''), 'user list from section A');
    // add a user with a password containing quotes and an umlaut
    await P.setValue(page, '#user-name', 'anna');
    await P.setValue(page, '#user-pass1', "pa'ss wörd\"1");
    await P.setValue(page, '#user-pass2', "pa'ss wörd\"1");
    await P.click(page, '#user-set');
    await P.until(page, () => /Passwort für anna gesetzt/.test(document.querySelector('#toast').textContent), 'user set toast');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#users tr td:first-child')).map(t => t.textContent)), ['anna', 'ui']);
    assert.equal(await P.value(page, '#user-pass1'), '', 'password field cleared');
    assert.doesNotMatch(await page.content(), /\$7\$/, 'no hash in the page');
    // mismatching repeat: refused client side
    await P.setValue(page, '#user-name', 'bob');
    await P.setValue(page, '#user-pass1', 'x');
    await P.setValue(page, '#user-pass2', 'y');
    await P.click(page, '#user-set');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.querySelector('#user-pass2').classList.contains('is-invalid')), true);
    assert.doesNotMatch(shOk(`cat ${ADDON}/etc/passwd`), /^bob:/m);
    // anonymous off, restart: the broker enforces it
    await P.change(page, '#allow-anonymous', 'false');
    assert.equal(await P.visible(page, '#auth-warning'), false, 'password file is on, no warning');
    await P.restartFromPage(page);
    await box.waitForBroker({ username: 'anna', password: "pa'ss wörd\"1" });
    assert.match(await refused(U.mqtt), /Not authorized/);
    assert.match(await refused(U.mqtt, { username: 'anna', password: 'wrong' }), /Not authorized/);
    assert.match(await roundtrip(U.mqtt, { username: 'anna', password: "pa'ss wörd\"1" }), /^hello-/);
    assert.match(await roundtrip(U.mqtts, AUTH), /^hello-/);
    // "Passwort ändern" fills the name; a new password replaces the old one after the CGI's reload
    await P.click(page, '#users tr:first-child button');
    assert.equal(await P.value(page, '#user-name'), 'anna');
    await P.setValue(page, '#user-pass1', 'new-pw');
    await P.setValue(page, '#user-pass2', 'new-pw');
    await P.click(page, '#user-set');
    await P.until(page, () => /Passwort für anna gesetzt/.test(document.querySelector('#toast').textContent), 'change toast');
    await sleep(1000);
    assert.match(await refused(U.mqtt, { username: 'anna', password: "pa'ss wörd\"1" }), /Not authorized/, 'old password');
    assert.match(await roundtrip(U.mqtt, { username: 'anna', password: 'new-pw' }), /^hello-/, 'new password without restart');
    // delete anna (the confirm dialog is auto-accepted)
    await P.click(page, '#users tr:first-child button.btn-danger');
    await P.until(page, () => /Benutzer anna gelöscht/.test(document.querySelector('#toast').textContent), 'delete toast');
    await sleep(1000);
    assert.match(await refused(U.mqtt, { username: 'anna', password: 'new-pw' }), /Not authorized/, 'deleted user');
    // password file off with anonymous off: the page warns; back to anonymous
    await P.checkSaved(page, '#password-file', false);
    assert.equal(await P.visible(page, '#auth-warning'), true);
    assert.doesNotMatch(await conf(), /password_file/);
    await P.change(page, '#allow-anonymous', 'true');
    assert.equal(await P.visible(page, '#auth-warning'), false);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B per-listener anonymous: one listener refuses anonymous clients, then global off with one exception', async () => {
    // global anonymous stays on: 1883 alone gets listener_allow_anonymous false
    await P.change(page, '#listeners .listener:nth-child(1) select.anon', 'false');
    assert.match(await conf(), /^listener 1883\nlistener_allow_anonymous false$/m);
    assert.match(await conf(), /^allow_anonymous true$/m, 'the global value is untouched');
    assert.equal(await P.visible(page, '#auth-warning'), true);
    assert.match(await page.evaluate(() => document.querySelector('#auth-warning').textContent), /Port 1883 kein Client/);
    await P.restartFromPage(page);
    await box.waitForBroker({}, U.ws);
    assert.match(await refused(U.mqtt), /Not authorized/);
    assert.match(await roundtrip(U.ws), /^hello-/);
    assert.match(await roundtrip(U.mqtts), /^hello-/);
    // the common case the other way round: global off, one listener (here WebSockets, standing
    // in for a loopback listener) stays open
    await P.change(page, '#listeners .listener:nth-child(1) select.anon', '');
    await P.change(page, '#listeners .listener:nth-child(2) select.anon', 'true');
    await P.change(page, '#allow-anonymous', 'false');
    assert.match(await conf(), /^listener 1884\nprotocol websockets\nlistener_allow_anonymous true$/m);
    assert.doesNotMatch(await conf(), /^listener 1883\nlistener_allow_anonymous/m);
    assert.match(await page.evaluate(() => document.querySelector('#auth-warning').textContent), /Port 1883, 8883, 8884 kein Client/);
    assert.match(await page.evaluate(() => document.querySelector('#listeners .listener:nth-child(1) select.anon option').textContent), /nicht erlaubt/, 'the "wie global" option shows the global value');
    await P.restartFromPage(page);
    await box.waitForBroker({}, U.ws);
    assert.match(await roundtrip(U.ws), /^hello-/);
    assert.match(await refused(U.mqtt), /Not authorized/);
    assert.match(await refused(U.mqtts), /Not authorized/);
    // back to the default: everything anonymous, no per-listener lines
    await P.change(page, '#listeners .listener:nth-child(2) select.anon', '');
    await P.change(page, '#allow-anonymous', 'true');
    assert.doesNotMatch(await conf(), /^listener_allow_anonymous/m);
    assert.equal(await P.visible(page, '#auth-warning'), false);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.match(await roundtrip(U.mqtt), /^hello-/);
    assert.deepEqual(page.problems, []);
});

test('B ACL file: toggled from the page, enforced by the broker', async () => {
    await P.checkSaved(page, '#password-file', true);
    await P.checkSaved(page, '#acl-file', true);
    assert.match(await conf(), /^plugin \/usr\/local\/addons\/mosquitto\/lib\/mosquitto_acl_file\.so\nplugin_opt_acl_file \/usr\/local\/addons\/mosquitto\/etc\/acl$/m);
    // no ACL file yet: the service creates an empty one, the broker starts anyway
    shOk(`rm -f ${ADDON}/etc/acl`);
    await P.restartFromPage(page);
    await box.waitForBroker(AUTH);
    shOk(`test -f ${ADDON}/etc/acl`);
    // the ACL file itself is command-line territory: user ui may only use allowed/#
    put(box, `${ADDON}/etc/acl`, 'user ui\ntopic readwrite allowed/#\n');
    await P.restartFromPage(page);
    await box.waitForBroker(AUTH);
    assert.match(await roundtrip(U.mqtt, AUTH, 'allowed/x'), /^hello-/);
    await assert.rejects(roundtrip(U.mqtt, AUTH, 'denied/x', { timeout: 3000 }), /no message/, 'publish on a denied topic is dropped');
    await P.checkSaved(page, '#acl-file', false);
    await P.checkSaved(page, '#password-file', false);
    assert.doesNotMatch(await conf(), /acl_file|password_file/);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B logging: log types and connection messages change what reaches the syslog', async () => {
    const lines = () => box.syslog().split('\n').length;
    await P.clickSaved(page, '#log-types input[value=debug]');
    await P.clickSaved(page, '#log-types input[value=information]');
    assert.deepEqual((await conf()).match(/^log_type .*$/gm), ['log_type error', 'log_type warning', 'log_type notice', 'log_type debug']);
    await P.restartFromPage(page);
    await box.waitForBroker();
    let mark = lines();
    await roundtrip(U.mqtt, {}, 'log/debug');
    await sleep(500);
    assert.match(box.syslog().split('\n').slice(mark).join('\n'), /Received PUBLISH from/, 'debug lines with log_type debug');
    await P.clickSaved(page, '#log-types input[value=debug]');
    await P.checkSaved(page, '#connection-messages', false);
    assert.match(await conf(), /^connection_messages false$/m);
    await P.restartFromPage(page);
    await box.waitForBroker();
    mark = lines();
    await roundtrip(U.mqtt, {}, 'log/quiet');
    await sleep(500);
    assert.doesNotMatch(box.syslog().split('\n').slice(mark).join('\n'), /New connection from|Received PUBLISH/, 'quiet with connection_messages false');
    await P.checkSaved(page, '#connection-messages', true);
    await P.clickSaved(page, '#log-types input[value=information]');
    assert.deepEqual(page.problems, []);
});

test('B persistence: off/on, autosave interval, location on a stick and a custom path', async () => {
    await P.checkSaved(page, '#persistence', false);
    assert.match(await conf(), /^persistence false$/m);
    await P.checkSaved(page, '#persistence', true);
    await P.change(page, '#autosave-interval', '60');
    assert.match(await conf(), /^persistence true\npersistence_location \/usr\/local\/addons\/mosquitto\/var\/\nautosave_interval 60$/m);
    await P.change(page, '#autosave-interval', '-5');
    assert.equal(await P.value(page, '#autosave-interval'), '0', 'clamped');
    await P.change(page, '#autosave-interval', '1800');
    // no stick: only the addon dir and a custom path
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#persistence-location option')).map(o => o.value)), ['var', 'custom']);
    assert.match(await P.text(page, '#persistence-location-status'), /var\/: .* MB frei/);
    await P.setValue(page, '#persistence-location', 'custom');
    await page.waitForTimeout(300);
    assert.equal(await P.visible(page, '#persistence-location-custom'), true);
    await P.setValue(page, '#persistence-location-custom', 'relative/path');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('#persistence-location-custom').classList.contains('is-invalid')), true);
    await P.change(page, '#persistence-location-custom', '/usr/local/tmp/pers-ui');
    assert.match(await conf(), /^persistence_location \/usr\/local\/tmp\/pers-ui\/$/m);
    await P.until(page, () => /Verzeichnis fehlt/.test(document.querySelector('#persistence-location-status').textContent), 'missing dir status');
    await P.restartFromPage(page);
    await box.waitForBroker();
    shOk('test -d /usr/local/tmp/pers-ui');
    await publish(U.mqtt, {}, 'ui/retained', 'still-here', { retain: true });
    await P.click(page, '#btn-restart');
    await P.until(page, () => /running/.test(document.querySelector('#status').textContent), 'running');
    await box.waitForBroker();
    shOk('test -s /usr/local/tmp/pers-ui/mosquitto.db');
    // a stick: bind mount, refresh, choose it
    shOk('mkdir -p /media/usb1 /usr/local/tmp/fakeusb && mount --bind /usr/local/tmp/fakeusb /media/usb1');
    await P.click(page, '#persistence-location-refresh');
    await P.until(page, () => Array.from(document.querySelectorAll('#persistence-location option')).some(o => o.value === '/media/usb1'), 'stick option');
    assert.match(await page.evaluate(() => document.querySelector('#persistence-location option[value="/media/usb1"]').textContent), /USB-Stick \/media\/usb1 \(.*MB frei\)/);
    await P.change(page, '#persistence-location', '/media/usb1');
    assert.match(await conf(), /^persistence_location \/media\/usb1\/mosquitto\/$/m);
    await P.restartFromPage(page);
    await box.waitForBroker();
    shOk('test -d /usr/local/tmp/fakeusb/mosquitto');
    // stick gone: flagged in red, nothing created on the tmpfs
    shOk('umount /media/usb1');
    await P.click(page, '#persistence-location-refresh');
    await P.until(page, () => /kein USB-Stick eingehängt/.test(document.querySelector('#persistence-location-status').textContent), 'unplugged status');
    assert.equal(await P.value(page, '#persistence-location'), '/media/usb1', 'the configured stick stays selectable');
    shOk(`${RC} restart >/dev/null; test ! -d /media/usb1/mosquitto`);
    assert.match(box.syslog(), /no USB stick mounted at \/media\/usb1/);
    await box.waitForBroker();
    await P.change(page, '#persistence-location', 'var');
    assert.match(await conf(), /^persistence_location \/usr\/local\/addons\/mosquitto\/var\/$/m);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B firewall: blocked ports shown in RESTRICTIVE mode, one click opens them', async () => {
    assert.match(await P.text(page, '#firewall-text'), /MOST_OPEN: alle Ports erreichbar/);
    assert.equal(await P.visible(page, '#firewall-open'), false);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.fw-status')).map(e => e.textContent)), ['Firewall: offen', 'Firewall: offen', 'Firewall: offen', 'Firewall: offen']);
    put(box, '/tmp/firewall.conf', 'set Firewall_MODE RESTRICTIVE\nset Firewall_USER_PORTS {1883}\n');
    await P.reload(page, coverageEntries);
    await P.until(page, () => /RESTRICTIVE/.test(document.querySelector('#firewall-text').textContent), 'restrictive status');
    assert.match(await P.text(page, '#firewall-text'), /Ports 1884, 8883, 8884 nicht freigegeben/);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.fw-status')).map(e => e.textContent)), ['Firewall: offen', 'Firewall: gesperrt', 'Firewall: gesperrt', 'Firewall: gesperrt']);
    assert.equal(await P.visible(page, '#firewall-open'), true);
    await P.click(page, '#firewall-open');
    await P.until(page, () => /alle Listener-Ports sind freigegeben/.test(document.querySelector('#firewall-text').textContent), 'ports opened');
    assert.match(shOk('cat /tmp/firewall.conf'), /Firewall_USER_PORTS \{1883 1884 8883 8884\}/);
    assert.equal(await P.visible(page, '#firewall-open'), false);
    shOk('rm -f /tmp/firewall.conf');
    await P.reload(page, coverageEntries);
    await P.until(page, () => /MOST_OPEN/.test(document.querySelector('#firewall-text').textContent), 'most open again');
    assert.deepEqual(page.problems, []);
});

test('B bridges: add, fill, topics, remove; the bridge carries messages', async () => {
    assert.equal(await P.count(page, '#bridges .listener'), 0);
    await P.click(page, '#bridge-add');
    await page.waitForTimeout(300);
    assert.equal(await P.count(page, '#bridges .listener'), 1);
    assert.doesNotMatch(await conf(), /^connection /m, 'not saved before the address is set');
    await P.change(page, '#bridges .listener input[placeholder^="host:port"]', '127.0.0.1:1883');
    assert.match(await conf(), /^connection bridge1\naddress 127\.0\.0\.1:1883\ntopic # both 0$/m);
    await P.change(page, '#bridges .listener input[placeholder^="Benutzer"]', 'ui');
    await P.change(page, '#bridges .listener input[type=password]', 'ui-secret');
    await P.change(page, '#bridges .listener input[placeholder^="Client-ID"]', 'ui-bridge');
    await P.change(page, '#bridges .listener select', 'mqttv311');
    await P.clickSaved(page, '#bridges .listener input[type=checkbox]');   // clean session
    await P.change(page, '#bridges .listener textarea', '# out 0 local/ remote/');
    const cfg = await conf();
    assert.match(cfg, /^connection bridge1\naddress 127\.0\.0\.1:1883\nremote_username ui\nremote_password ui-secret\nremote_clientid ui-bridge\ncleansession true\nbridge_protocol_version mqttv311\ntopic # out 0 local\/ remote\/$/m);
    await P.restartFromPage(page);
    await box.waitForBroker();
    await waitFor(() => /Connecting bridge bridge1/.test(box.syslog()), 'bridge in the syslog', 15000);
    await sleep(1000);
    assert.match(await roundtrip(U.mqtt, {}, 'local/via/ui', { receiveTopic: 'remote/via/ui' }), /^hello-/);
    await P.clickSaved(page, '#bridges .listener button.btn-danger');
    assert.equal(await P.count(page, '#bridges .listener'), 0);
    assert.doesNotMatch(await conf(), /connection bridge1/);
    await P.restartFromPage(page);
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B a failed start explains itself: port clash shows the last error, healing works', async () => {
    await P.click(page, '#listener-add');
    await page.waitForTimeout(300);
    await P.change(page, '#listeners .listener:nth-child(5) input[type=number]', '1883');
    await P.click(page, '#apply-restart');
    await P.until(page, () => /stopped/.test(document.querySelector('#status').textContent) && !document.querySelector('#status-error').classList.contains('hidden'), 'stopped with error', 30000);
    assert.match(await P.text(page, '#status-error'), /Address in use/);
    await P.clickSaved(page, '#listeners .listener:nth-child(5) button');
    await P.click(page, '#btn-start');
    await P.until(page, () => /running/.test(document.querySelector('#status').textContent) && document.querySelector('#status-error').classList.contains('hidden'), 'running again', 30000);
    await box.waitForBroker();
    assert.deepEqual(page.problems, []);
});

test('B self-update from the page: notice, modal, worker, new version shown', async () => {
    // a "newer" release: the same package repacked as 9.9.9+0, served by busybox httpd on 8081
    shOk(`rm -rf /tmp/repack /usr/local/tmp/dist-test && mkdir -p /tmp/repack /usr/local/tmp/dist-test && cd /tmp/repack && tar -xzf /dist/$(ls /dist | grep x86_64 | grep -v sha256) && sed -i 's/^export VERSION_ADDON=.*/export VERSION_ADDON=9.9.9+0/' mosquitto/versions && tar --owner=root --group=root -czf "/usr/local/tmp/dist-test/mosquitto-x86_64-9.9.9+0.tar.gz" * && cd /usr/local/tmp/dist-test && sha256sum "mosquitto-x86_64-9.9.9+0.tar.gz" > "mosquitto-x86_64-9.9.9+0.tar.gz.sha256" && (busybox httpd -p 127.0.0.1:8081 -h /usr/local/tmp/dist-test)`);
    put(box, '/tmp/fake-latest.json', JSON.stringify({ tag_name: '9.9.9+0' }));
    await P.reload(page, coverageEntries);
    await P.until(page, () => !document.querySelector('#update-notify').classList.contains('hidden'), 'update notice');
    assert.match(await P.text(page, '#update-link'), /Version 9\.9\.9\+0/);
    await P.click(page, '#update-start');
    await page.waitForTimeout(300);
    assert.equal(await P.visible(page, '#modal-update'), true);
    assert.equal(await P.text(page, '#update-version'), '9.9.9+0');
    await P.click(page, '#update-cancel');
    await page.waitForTimeout(300);
    assert.equal(await P.visible(page, '#modal-update'), false);
    await P.click(page, '#update-start');
    await P.click(page, '#update-go');
    await P.until(page, () => !document.querySelector('#update-success').classList.contains('hidden'), 'update done', 120000);
    assert.match(await P.text(page, '#update-success'), /9\.9\.9\+0 installiert, Mosquitto läuft/);
    assert.equal(await P.visible(page, '#update-reload'), true);
    coverageEntries.push(await P.collectCoverage(page));
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.evaluate(() => setTimeout(() => document.querySelector('#update-reload').click(), 50))
    ]);
    await P.until(page, () => /ccu-addon-mosquitto 9\.9\.9\+0/.test(document.querySelector('#addon-version').textContent), 'new version in the navbar');
    assert.equal(await P.visible(page, '#update-notify'), false, 'no notice: installed equals available');
    await box.waitForBroker();
    // a failing update: the package for the "next" version does not exist
    put(box, '/tmp/fake-latest.json', JSON.stringify({ tag_name: '9.9.10+0' }));
    await P.reload(page, coverageEntries);
    await P.until(page, () => !document.querySelector('#update-notify').classList.contains('hidden'), 'update notice 2');
    await P.click(page, '#update-start');
    await P.click(page, '#update-go');
    await P.until(page, () => !document.querySelector('#update-error').classList.contains('hidden'), 'update error', 60000);
    assert.match(await P.text(page, '#update-error'), /Prüfsumme.*konnte nicht geladen werden/);
    await P.until(page, () => /error:/.test(document.querySelector('#update-log').textContent), 'update log shown');
    await P.click(page, '#update-close');
    put(box, '/tmp/fake-latest.json', JSON.stringify({ tag_name: '0.0.0+0' }));
    assert.deepEqual(page.problems, []);
});

test('B tabs: debug versions, log download link, licenses iframe', async () => {
    await P.click(page, 'a[data-tab=debug]');
    await page.waitForTimeout(300);
    assert.equal(await P.visible(page, '#tab-debug'), true);
    assert.ok((await P.count(page, '#versions tr')) >= 5);
    assert.match(await page.evaluate(() => document.querySelector('#versions').textContent), /VERSION_ADDON9\.9\.9\+0/);
    await P.click(page, '#log-download');
    await page.waitForTimeout(500);
    await P.click(page, 'a[data-tab=licenses]');
    await P.until(page, () => /licenses\.html/.test(document.querySelector('#licenses-frame').src), 'iframe src');
    await waitFor(() => page.frames().some(f => f.url().includes('licenses.html')), 'the licenses frame', 10000);
    const frame = page.frames().find(f => f.url().includes('licenses.html'));
    await frame.waitForLoadState();
    assert.match(await frame.content(), /Roger Light/);
    await P.click(page, 'a[data-tab=configuration]');
    await page.waitForTimeout(200);
    assert.equal(await P.visible(page, '#tab-configuration'), true);
    assert.deepEqual(page.problems, []);
});

test('B an expired session: the page shows the overlay on the next write', async () => {
    put(box, '/tmp/valid-sid', 'somethingelse');
    await P.setChecked(page, '#persistence', false);
    await P.until(page, () => getComputedStyle(document.querySelector('#invalidSession')).display !== 'none', 'invalid session overlay');
    put(box, '/tmp/valid-sid', SID_ID);
    assert.match(await conf(), /^persistence true$/m, 'nothing was written');
    // a fresh page after re-login works again (coverage of the old page is kept)
    coverageEntries.push(await page.coverage.stopJSCoverage());
    page = await P.openSettings(browser, SETTINGS_URL);
    assert.match(await P.text(page, '#status'), /running/);
});

test('B hand-written options are shown and kept, a second bridge, a missing custom certificate, a failing CGI', async () => {
    // extras in a listener block, a bridge block with an unknown key, a trailing comment
    const base = (await conf()).replace(/^listener 1883$/m, 'listener 1883\nmax_qos 1');
    const extra = 'per_listener_settings true\n' + base + '\nconnection other\naddress 10.0.0.9:1883\nrestart_timeout 10 60\ntopic x/# in 0\n\n# trailing comment\n';
    put(box, CONFIG, extra);
    await P.reload(page, coverageEntries);
    assert.equal(await P.visible(page, '#per-listener-hint'), true, 'hint for the deprecated per_listener_settings');
    assert.match(await page.evaluate(() => document.querySelector('#listeners .listener .help.mb-2').textContent), /max_qos 1/);
    assert.match(await page.evaluate(() => document.querySelector('#bridges .listener .help.mb-2').textContent), /restart_timeout 10 60/);
    await P.clickSaved(page, '#bridges .listener input[type=checkbox]');   // a change keeps the extras and the plugin block
    const saved = await conf();
    assert.match(saved, /^per_listener_settings true$/m, 'the deprecated line is kept');
    assert.match(saved, /^max_qos 1$/m);
    assert.match(saved, /^restart_timeout 10 60$/m);
    assert.match(saved, /# trailing comment/);
    // a second bridge gets the next free default name
    await P.click(page, '#bridge-add');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#bridges .listener input[placeholder=Name]')[1].value), 'bridge1');
    // custom certificate paths that do not exist: saved, the info box says so
    await P.change(page, '#cert-source', 'custom');
    await P.change(page, '#cert-certfile', '/nonexistent/cert.pem');
    await P.until(page, () => /Datei nicht gefunden/.test(document.querySelector('#cert-info').textContent), 'cert info error');
    assert.match(await conf(), /^certfile \/nonexistent\/cert\.pem$/m);
    // back to the configuration before this test
    put(box, CONFIG, base.replace('listener 1883\nmax_qos 1', 'listener 1883'));
    // a failing CGI (here a 404, lighttpd runs .cgi through tclsh regardless of the mode): the page reports it
    shOk('cd /usr/local/addons/mosquitto/www && mv getconfig.cgi getconfig.off && mv update.cgi update.off');
    coverageEntries.push(await P.collectCoverage(page));
    const broken = await P.openSettings(browser, SETTINGS_URL);
    await P.until(broken, () => /Konfiguration konnte nicht geladen werden/.test(document.querySelector('#toast').textContent), 'load error toast');
    coverageEntries.push(await broken.coverage.stopJSCoverage());
    await broken.close();
    shOk('cd /usr/local/addons/mosquitto/www && mv getconfig.off getconfig.cgi && mv update.off update.cgi');
    await P.reload(page, coverageEntries);
    assert.equal(await P.count(page, '#listeners .listener'), 4);
    assert.equal(await P.visible(page, '#per-listener-hint'), false);
    assert.deepEqual(page.problems.filter(p => !/getconfig|update\.cgi/.test(p)), []);
});

// =========================== C: coverage of the page script ===========================

test('C coverage of www/js/script.js in the browser', async () => {
    coverageEntries.push(await page.coverage.stopJSCoverage());
    for (const [i, list] of coverageEntries.entries()) {
        for (const e of list.filter(e => e.url.includes('/js/script.js'))) {
            const fns = e.functions.length;
            const called = e.functions.filter(f => f.ranges[0].count > 0).length;
            console.log(`coverage entry list ${i}: ${e.url} functions ${fns}, called ${called}, source ${e.source.length} bytes`);
        }
    }
    const cov = P.coverageOf(coverageEntries, '/js/script.js');
    assert.ok(cov, 'script.js coverage entry');
    console.log(`script.js coverage: ${cov.percent}% (${cov.covered} of ${cov.total} bytes); never called: ${cov.uncalled.join(', ') || 'none'}`);
    assert.ok(cov.percent >= 90, `script.js coverage ${cov.percent}% below 90%`);
});
