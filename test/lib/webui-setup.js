// Turns the test container into a CCU-like web host for the settings page
// (webui.test.js): lighttpd with the firmware's CGI rules, a stub of the
// firmware's tclrega.so (session check), a stub of /lib/libfirewall.tcl,
// and a fake curl for the GitHub release lookups. Node.js and all of this
// are test tooling only.

const SID_ID = 'e2eSession';           // ten alphanumerics, what the CCU hands to Config-Url
const SID = `@${SID_ID}@`;

const fs = require('node:fs');
const path = require('node:path');
const stub = name => fs.readFileSync(path.join(__dirname, name), 'utf8');

// GitHub API lookups answer from /tmp/fake-latest.json, everything else goes to the real curl
const FAKE_CURL = `#!/bin/sh
case "$*" in
    *api.github.com*) cat /tmp/fake-latest.json 2>/dev/null; exit 0 ;;
esac
exec /usr/bin/curl "$@"
`;

// write a file in the container from a JS string (base64 avoids every quoting problem)
function put(box, file, content, mode) {
    const b64 = Buffer.from(content).toString('base64');
    box.shOk(`mkdir -p $(dirname ${file}) && echo '${b64}' | base64 -d > ${file}${mode ? ` && chmod ${mode} ${file}` : ''}`);
}

function setupWebUI(box) {
    put(box, '/etc/lighttpd/ccu.conf', stub('lighttpd-ccu.conf'));
    put(box, '/tmp/tclrega.c', stub('tclrega-stub.c'));
    put(box, '/lib/libfirewall.tcl', stub('libfirewall-stub.tcl'));
    put(box, '/usr/local/bin/curl', FAKE_CURL, '755');
    box.shOk('gcc -shared -fPIC $(pkg-config --cflags tcl) -o /usr/lib/tclrega.so /tmp/tclrega.c');
    box.shOk(`mkdir -p /www && ln -sfn /usr/local/etc/config/addons/www /www/addons && echo ${SID_ID} > /tmp/valid-sid`);
    box.shOk('lighttpd -f /etc/lighttpd/ccu.conf');
    put(box, '/tmp/fake-latest.json', JSON.stringify({ tag_name: '0.0.0+0' }));
}

// what the settings page would call: GET/POST a CGI with the session
async function cgi(box, pathAndQuery, body) {
    const url = `${box.U.http}/addons/mosquitto/${pathAndQuery}`;
    const res = body === undefined
        ? await fetch(url)
        : await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return { status: res.status, text: await res.text() };
}

module.exports = { SID, SID_ID, setupWebUI, put, cgi, WEB_PACKAGES: ['lighttpd', 'tcl-dev', 'gcc', 'libc6-dev', 'pkg-config'] };
