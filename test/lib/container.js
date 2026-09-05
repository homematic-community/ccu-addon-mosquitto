// Shared helpers for the container based test suites (e2e.test.js,
// webui.test.js): a Debian container that gets what a CCU has, OpenCCU's
// installer replayed through docker exec, and mqtt client helpers against
// the published ports. Node.js is a test tool only; nothing of it ships.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const mqtt = require('mqtt');

const DIST = path.resolve(process.env.DIST || path.join(__dirname, '..', '..', 'dist'));
const PKG = fs.readdirSync(DIST).find(f => /^mosquitto-x86_64-.*\.tar\.gz$/.test(f));
if (!PKG) throw new Error(`no mosquitto-x86_64-*.tar.gz in ${DIST} (run ./build_addon.sh x86_64 first)`);

const HOST = '127.0.0.1';
const ADDON = '/usr/local/addons/mosquitto';
const BIN = `${ADDON}/bin`;
const CONFIG = `${ADDON}/etc/mosquitto.conf`;
const RC = '/usr/local/etc/config/rc.d/mosquitto';

function docker(args) {
    const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (await fn()) return;
        await sleep(500);
    }
    throw new Error(`timeout waiting for ${what}`);
}

// A container instance: {name, ports} -> helpers bound to it.
// ports: {mqtt, ws, mqtts, wss, http} host ports to publish (http only for the web UI suite)
function container(name, ports) {
    const sh = cmd => docker(['exec', name, 'sh', '-c', cmd]);
    const shOk = cmd => {
        const r = sh(cmd);
        assert.equal(r.code, 0, `command failed (${r.code}): ${cmd}\n${r.out}`);
        return r.out;
    };
    const U = {
        mqtt: `mqtt://${HOST}:${ports.mqtt}`,
        ws: `ws://${HOST}:${ports.ws}`,
        mqtts: `mqtts://${HOST}:${ports.mqtts}`,
        wss: `wss://${HOST}:${ports.wss}`
    };
    if (ports.http) U.http = `http://${HOST}:${ports.http}`;

    return {
        name, ports, U, sh, shOk,

        // start the container with what a CCU has: busybox sh and syslogd, tcl
        // for update_addon and the CGI helpers, curl, openssl, a CCU-style server.pem
        start(extraPackages = []) {
            docker(['rm', '-f', name]);
            const publish = [['mqtt', 1883], ['ws', 1884], ['mqtts', 8883], ['wss', 8884], ['http', 80]]
                .filter(([k]) => ports[k]).flatMap(([k, p]) => ['-p', `${HOST}:${ports[k]}:${p}`]);
            // --init: a reaping pid 1, or stopped daemons stay as zombies that pgrep still finds;
            // --privileged: bind mounts for the USB stick tests
            const r = docker(['run', '-d', '--init', '--privileged', '--platform', 'linux/amd64', '--name', name,
                ...publish, '-v', `${DIST}:/dist:ro`, 'debian:bookworm-slim', 'sleep', 'infinity']);
            assert.equal(r.code, 0, `docker run failed: ${r.out}`);
            shOk(`export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends curl ca-certificates iproute2 procps busybox openssl tcl ${extraPackages.join(' ')} >/dev/null`);
            shOk('mkdir -p /media && mount -t tmpfs tmpfs /media && busybox syslogd -O /var/log/messages && mkdir -p /usr/local/tmp /usr/local/etc/config/rc.d /usr/local/etc/config/addons/www /etc/config && ln -sf /bin/busybox /bin/sh');
            shOk('openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 -subj /CN=e2e-ccu -keyout /tmp/ccu.key -out /tmp/ccu.crt 2>/dev/null && cat /tmp/ccu.crt /tmp/ccu.key > /etc/config/server.pem');
        },

        stop() {
            if (process.env.KEEP) {
                console.log(`container ${name} kept (KEEP=1)`);
                return;
            }
            docker(['rm', '-f', name]);
        },

        // what OpenCCU's /bin/install_addon does: extract into a temp dir below
        // /usr/local/tmp, run update_script from inside it, delete the temp dir
        installAddon(pkg = `/dist/${PKG}`) {
            return sh(`dir=$(mktemp -d -p /usr/local/tmp) && tar -C "$dir" --no-same-owner --no-same-permissions -xf ${pkg} && (cd "$dir" && ./update_script HM-RASPBERRYMATIC >/tmp/update_script.log 2>&1); rc=$?; rm -rf "$dir"; cat /tmp/update_script.log; exit $rc`);
        },

        brokerPid() {
            return sh('pgrep -x mosquitto | head -1').out.trim();
        },

        syslog() {
            return sh('cat /var/log/messages').out;
        },

        async waitForBroker(opts = {}, url = U.mqtt) {
            await waitFor(async () => { try { (await connect(url, opts)).end(true); return true; } catch (e) { return false; } }, 'the broker', 30000);
        }
    };
}

// --- mqtt helpers -----------------------------------------------------------------

// connect and resolve with the client, reject with the broker's reason
function connect(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const c = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 5000, rejectUnauthorized: false, ...opts });
        const fail = err => { c.removeAllListeners(); c.on('error', () => {}); c.end(true); reject(err instanceof Error ? err : new Error(String(err))); };
        c.once('connect', () => { c.removeListener('error', fail); c.removeListener('close', fail); resolve(c); });
        c.once('error', fail);
        c.once('close', () => fail(new Error('connection closed before CONNACK')));
    });
}

// publish on one connection, receive on another; resolves with the payload,
// rejects after 10 s (or extra.timeout) when nothing arrives
async function roundtrip(url, opts = {}, topic = `e2e/${Date.now()}`, extra = {}) {
    const sub = await connect(url, opts);
    const pub = await connect(url, opts);
    try {
        const receiveTopic = extra.receiveTopic || topic;
        const got = new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`no message on ${receiveTopic} within ${extra.timeout || 10000} ms`)), extra.timeout || 10000);
            sub.on('message', (t2, payload) => { if (t2 === receiveTopic) { clearTimeout(t); resolve(payload.toString()); } });
        });
        await sub.subscribeAsync(receiveTopic);
        await pub.publishAsync(topic, `hello-${Date.now()}`, extra.publish || {});
        return await got;
    } finally {
        sub.end(true);
        pub.end(true);
    }
}

// the broker must refuse the connection; returns the error message
async function refused(url, opts = {}) {
    try {
        const c = await connect(url, opts);
        c.end(true);
    } catch (err) {
        return err.message;
    }
    throw new Error(`connection to ${url} succeeded, expected a refusal`);
}

// publish with QoS 1 and close gracefully (a forced end can drop a QoS 0 packet)
async function publish(url, opts, topic, payload, pubOpts = {}) {
    const c = await connect(url, opts);
    await c.publishAsync(topic, payload, { qos: 1, ...pubOpts });
    await new Promise(resolve => c.end(false, resolve));
}

module.exports = { DIST, PKG, HOST, ADDON, BIN, CONFIG, RC, docker, sleep, waitFor, container, connect, roundtrip, refused, publish };
