// Writes the addon's licenses page (www/licenses.html) from the resolved
// Alpine package list (build_addon.sh):
//
//   node build_licenses.js <packages.json> <addon version> > licenses.html
//
// The Alpine packages carry no license texts, only the SPDX identifier and
// the upstream URL in the index - that is what the page lists, with links to
// the license texts on spdx.org.

const fs = require('fs');

const [file, version] = process.argv.slice(2);
const packages = JSON.parse(fs.readFileSync(file, 'utf8'));

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "EPL-1.0 OR EPL-2.0" -> links per identifier
function license(expr) {
    return esc(expr || 'n/a').split(/\s+/).map(token =>
        /^[A-Za-z0-9.+-]+$/.test(token) && !/^(OR|AND|WITH)$/.test(token)
            ? `<a href="https://spdx.org/licenses/${token}.html" target="_blank">${token}</a>`
            : token
    ).join(' ');
}

const rows = packages
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `<tr><td>${p.url ? `<a href="${esc(p.url)}" target="_blank">${esc(p.name)}</a>` : esc(p.name)}</td>` +
        `<td>${esc(p.version)}</td><td>${license(p.license)}</td></tr>`)
    .join('\n');

process.stdout.write(`<!DOCTYPE html>
<meta charset="UTF-8">
<title>Lizenzen</title>
<style>
body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 14px; color: #212529; margin: 16px; }
table { border-collapse: collapse; }
th, td { text-align: left; padding: 4px 16px 4px 0; border-bottom: 1px solid #dee2e6; }
a { color: #007bff; text-decoration: none; }
</style>
<h5>ccu-addon-mosquitto ${esc(version)}</h5>
<p>
    <a href="https://github.com/homematic-community/ccu-addon-mosquitto" target="_blank">ccu-addon-mosquitto</a>
    &copy; 2018-${new Date().getFullYear()} Sebastian Raff and contributors, dual licensed under the
    <a href="https://spdx.org/licenses/EPL-1.0.html" target="_blank">Eclipse Public License 1.0</a> and the
    <a href="https://spdx.org/licenses/BSD-3-Clause.html" target="_blank">Eclipse Distribution License 1.0</a>.
</p>
<p>
    Bundled components (binaries from <a href="https://alpinelinux.org/" target="_blank">Alpine Linux</a> packages):
</p>
<table>
<tr><th>Component</th><th>Version</th><th>License</th></tr>
${rows}
</table>
`);
