// Checks the pinned Mosquitto version against the newest Mosquitto release
// and, on request, applies the bump. Used by the auto-release workflow
// (ROADMAP task 7) and by hand:
//
//   node update_versions.js            report only
//   node update_versions.js --apply    set package.json to <newest>+0 and
//                                      write RELEASE_SUMMARY.md for the
//                                      release body
//   node update_versions.js --bump     with --apply and no new Mosquitto:
//                                      bump the addon build (2.1.2+0 -> 2.1.2+1)
//   node update_versions.js --json     print a JSON result; with GITHUB_OUTPUT
//                                      set, also write updates/major/version/
//                                      current/latest/summary
//
// Source of truth: the tags of eclipse-mosquitto/mosquitto (vX.Y.Z, release
// candidates ignored). A major switch is never applied automatically -
// the configuration UI's model has to be checked first.

const fs = require('fs');

const ROOT = __dirname;
const PACKAGE = `${ROOT}/package.json`;
const TAGS_URL = 'https://api.github.com/repos/eclipse-mosquitto/mosquitto/tags?per_page=100';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const bump = args.has('--bump');
const json = args.has('--json');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, '  ') + '\n');
}

// "2.1.2+3" -> { mosquitto: "2.1.2", build: 3 }
function splitVersion(version) {
    const m = /^(\d+\.\d+\.\d+)\+(\d+)$/.exec(version);
    if (!m) {
        throw new Error(`addon version "${version}" is not <x.y.z>+<n>`);
    }
    return { mosquitto: m[1], build: Number(m[2]) };
}

function parse(version) {
    return version.split('.').map(Number);
}

function compare(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    return (pa[0] - pb[0]) || (pa[1] - pb[1]) || (pa[2] - pb[2]);
}

async function mosquittoReleases() {
    const headers = { 'User-Agent': 'ccu-addon-mosquitto update_versions' };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(TAGS_URL, { headers });
    if (!res.ok) {
        throw new Error(`${TAGS_URL}: ${res.status} ${res.statusText}`);
    }
    const tags = await res.json();
    return tags
        .map(t => t.name)
        .filter(name => /^v\d+\.\d+\.\d+$/.test(name))
        .map(name => name.slice(1))
        .sort(compare);
}

// the part of the release body that says this release was made by the workflow
function summary(from, to, version, forced) {
    const what = forced
        ? `Mosquitto ist unverändert bei **${to}**, das Addon-Paket wurde neu gebaut (manuell ausgelöster Lauf).`
        : `eine neue Mosquitto-Version erschienen ist: **${from} → ${to}**.`;
    return `### 🤖 Automatisches Release ${version}

Dieses Release wurde automatisch von einem GitHub-Workflow erstellt, weil
${what}
Am Addon selbst wurde dabei nichts verändert; der Build für alle drei
Architekturen und der automatische End-to-End-Test (Installation, Start,
Pub/Sub, WebSockets, TLS, Passwortdatei, Update, Migration) sind erfolgreich
durchgelaufen. Änderungen am Addon seit dem letzten Release stehen unten
unter „Changes". Die Änderungen an Mosquitto selbst:
https://github.com/eclipse-mosquitto/mosquitto/blob/v${to}/ChangeLog.txt

`;
}

async function main() {
    const pkg = readJson(PACKAGE);
    const current = splitVersion(pkg.version);
    const releases = await mosquittoReleases();
    if (releases.length === 0) {
        throw new Error('no release tags found');
    }
    const latestAny = releases[releases.length - 1];
    const sameMajor = releases.filter(v => parse(v)[0] === parse(current.mosquitto)[0]);
    const latest = sameMajor.length ? sameMajor[sameMajor.length - 1] : current.mosquitto;
    const major = compare(latestAny, latest) > 0;
    const newer = compare(latest, current.mosquitto) > 0;

    console.log(`Mosquitto ${current.mosquitto} (addon ${pkg.version}) ${newer ? `-> ${latest}` : 'up to date'}`
        + (major ? ` - NOTE: ${latestAny} is a new major version, not applied automatically` : ''));

    const result = { updates: newer, major, current: current.mosquitto, latest: major ? latestAny : latest,
        version: { from: pkg.version, to: pkg.version } };

    if (apply) {
        if (newer) {
            result.version.to = `${latest}+0`;
        } else if (bump) {
            result.version.to = `${current.mosquitto}+${current.build + 1}`;
        }
        if (result.version.to !== pkg.version) {
            pkg.version = result.version.to;
            writeJson(PACKAGE, pkg);
            fs.writeFileSync(`${ROOT}/RELEASE_SUMMARY.md`,
                summary(current.mosquitto, newer ? latest : current.mosquitto, pkg.version, !newer));
            console.log(`addon version ${result.version.from} -> ${result.version.to} (package.json, RELEASE_SUMMARY.md written)`);
        } else {
            console.log('nothing to apply');
        }
    }

    if (json) {
        console.log(JSON.stringify(result));
    }
    if (process.env.GITHUB_OUTPUT) {
        const line = newer ? `Mosquitto ${current.mosquitto} -> ${latest}` : '';
        fs.appendFileSync(process.env.GITHUB_OUTPUT,
            `updates=${newer}\nmajor=${major}\nversion=${result.version.to}\ncurrent=${current.mosquitto}\nlatest=${result.latest}\nsummary=${line}\n`);
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
