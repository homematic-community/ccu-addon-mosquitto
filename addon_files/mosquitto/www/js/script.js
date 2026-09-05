/*
 * Settings page of the Mosquitto addon. No framework: the mosquitto.conf
 * parser/serialiser (managed keys + verbatim passthrough, modelled on she's
 * src/lib/mosquitto-conf.js), a few DOM helpers and the calls to the CGIs.
 *
 * The model part comes first and is exported when the file is loaded by
 * node (test/parser.test.js); the page part follows.
 */
(() => {
    'use strict';

    const ADDON = '/usr/local/addons/mosquitto';
    const PASSWD_FILE = ADDON + '/etc/passwd';
    const ACL_FILE = ADDON + '/etc/acl';
    const PLUGIN_PASSWD = ADDON + '/lib/mosquitto_password_file.so';
    const PLUGIN_ACL = ADDON + '/lib/mosquitto_acl_file.so';
    const CCU_CERT = '/etc/config/server.pem';
    const ADDON_CERT = ADDON + '/etc/certs/server.crt';
    const ADDON_KEY = ADDON + '/etc/certs/server.key';
    const DEFAULT_LOG_TYPES = ['error', 'warning', 'notice', 'information'];

    // --- mosquitto.conf model -------------------------------------------------------
    //
    // parse() turns the file into an ordered list of items:
    //   {type: 'line', text}                 comments, blanks, unmanaged keys
    //   {type: 'global', key, value}         a managed global key
    //   {type: 'listener', ...}              a listener block (line + sub-keys)
    //   {type: 'bridge', ...}                a connection block (bridge)
    //   {type: 'plugin', path, opts, lines}  a plugin block (plugin + plugin_opt_*)
    // serialise() writes the items back in order, replacing the managed ones
    // with the current state, dropping removed ones and appending new ones.

    // keys known to be global - they end a listener or bridge block. Everything
    // else after a listener/connection line stays inside its block, so a
    // hand-written option this page does not know is never moved elsewhere.
    const GLOBAL_KEYS = new Set([
        'allow_anonymous', 'persistence', 'persistence_location', 'persistence_file', 'autosave_interval',
        'autosave_on_changes', 'log_dest', 'log_type', 'log_timestamp', 'log_timestamp_format', 'log_facility',
        'connection_messages', 'user', 'pid_file', 'include_dir', 'per_listener_settings', 'sys_interval',
        'plugin', 'global_plugin', 'password_file', 'acl_file', 'max_inflight_messages', 'max_queued_messages',
        'max_packet_size', 'message_size_limit', 'max_keepalive', 'persistent_client_expiration',
        'retain_available', 'set_tcp_nodelay', 'queue_qos0_messages', 'upgrade_outgoing_qos',
        'allow_duplicate_messages', 'memory_limit', 'max_inflight_bytes', 'max_queued_bytes',
        'check_retain_source', 'allow_zero_length_clientid', 'auto_id_prefix', 'clientid_prefixes'
    ]);
    const MANAGED_GLOBALS = ['allow_anonymous', 'persistence', 'persistence_location', 'autosave_interval', 'connection_messages', 'log_type', 'password_file', 'acl_file'];
    const VAR_DIR = ADDON + '/var/';
    const LISTENER_KEYS = ['protocol', 'certfile', 'keyfile', 'tls_version', 'max_connections'];
    // bridge keys with one value (topic lines are collected separately)
    const BRIDGE_KEYS = ['address', 'remote_username', 'remote_password', 'remote_clientid', 'cleansession',
        'bridge_protocol_version', 'bridge_cafile', 'bridge_insecure', 'notifications', 'try_private'];

    function splitLine(line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return null;
        const space = trimmed.search(/\s/);
        if (space === -1) return { key: trimmed, value: '' };
        return { key: trimmed.slice(0, space), value: trimmed.slice(space + 1).trim() };
    }

    function newListener(port) {
        return { type: 'listener', port, bind: '', protocol: 'mqtt', tls: false, certfile: '', keyfile: '', tls_version: '', max_connections: '', extras: [] };
    }

    function newBridge(name) {
        return { type: 'bridge', name, address: '', remote_username: '', remote_password: '', remote_clientid: '',
            cleansession: '', bridge_protocol_version: '', bridge_cafile: '', bridge_insecure: '', notifications: '',
            try_private: '', topics: [], extras: [] };
    }

    function parse(text) {
        const lines = text.replace(/\r/g, '').split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        const items = [];
        let current = null; // open listener, bridge or plugin block

        // trailing blank and comment lines of a listener/bridge block belong
        // to whatever follows (a comment introducing the next block must not
        // vanish with this one): hand them back to the file level
        const closeBlock = () => {
            if (!current || (current.type !== 'listener' && current.type !== 'bridge')) return;
            const trailing = [];
            while (current.extras.length && !splitLine(current.extras[current.extras.length - 1])) {
                trailing.unshift(current.extras.pop());
            }
            items.push(...trailing.map(text => ({ type: 'line', text })));
        };

        for (const line of lines) {
            const kv = splitLine(line);
            if (current && current.type === 'plugin') {
                if (kv && kv.key.startsWith('plugin_opt_')) {
                    current.opts[kv.key.slice('plugin_opt_'.length)] = kv.value;
                    current.lines.push(...current.pending, line);
                    current.pending = [];
                    continue;
                }
                if (!kv) { current.pending.push(line); continue; }
                items.push(...current.pending.map(text => ({ type: 'line', text })));
                current.pending = [];
                current = null;
            }
            if (kv && kv.key === 'listener') {
                closeBlock();
                const parts = kv.value.split(/\s+/);
                current = newListener(parts[0]);
                current.bind = parts[1] || '';
                items.push(current);
                continue;
            }
            if (kv && kv.key === 'connection') {
                closeBlock();
                current = newBridge(kv.value);
                items.push(current);
                continue;
            }
            if (kv && (kv.key === 'plugin' || kv.key === 'global_plugin')) {
                closeBlock();
                current = { type: 'plugin', keyword: kv.key, path: kv.value, opts: {}, lines: [line], pending: [] };
                items.push(current);
                continue;
            }
            if (current && current.type === 'listener' && !(kv && GLOBAL_KEYS.has(kv.key))) {
                if (kv && LISTENER_KEYS.includes(kv.key)) current[kv.key] = kv.value;
                else current.extras.push(line);
                continue;
            }
            if (current && current.type === 'bridge' && !(kv && GLOBAL_KEYS.has(kv.key))) {
                if (kv && kv.key === 'topic') current.topics.push(kv.value);
                else if (kv && BRIDGE_KEYS.includes(kv.key)) current[kv.key] = kv.value;
                else current.extras.push(line);
                continue;
            }
            closeBlock();
            current = null;
            if (kv && MANAGED_GLOBALS.includes(kv.key)) {
                items.push({ type: 'global', key: kv.key, value: kv.value });
            } else {
                items.push({ type: 'line', text: line });
            }
        }
        if (current && current.type === 'plugin') {
            items.push(...current.pending.map(text => ({ type: 'line', text })));
            current.pending = [];
        }
        return items;
    }

    // the editable state, derived from the items
    const state = {
        items: [],
        listeners: [],
        bridges: [],
        allowAnonymous: false,
        persistence: false,
        persistenceLocation: '',   // '' = mosquitto default (the working directory)
        autosaveInterval: '',
        connectionMessages: true,
        logTypes: DEFAULT_LOG_TYPES.slice(),
        logTypesExplicit: false,
        passwordFile: '',      // '' = off
        aclFile: '',
        certSource: 'ccu',
        customChosen: false,
        certfile: CCU_CERT,
        keyfile: CCU_CERT,
        tlsVersion: ''
    };

    function load(text) {
        state.items = parse(text);
        state.listeners = state.items.filter(i => i.type === 'listener');
        state.bridges = state.items.filter(i => i.type === 'bridge');
        for (const l of state.listeners) {
            l.tls = !!(l.certfile || l.keyfile);
        }
        const globals = {};
        const logTypes = [];
        for (const i of state.items) {
            if (i.type === 'global') {
                if (i.key === 'log_type') logTypes.push(...i.value.split(/\s+/).filter(Boolean));
                else if (globals[i.key] === undefined) globals[i.key] = i.value;
            }
        }
        state.allowAnonymous = globals.allow_anonymous === 'true';
        state.persistence = globals.persistence === 'true';
        state.persistenceLocation = globals.persistence_location || '';
        state.autosaveInterval = globals.autosave_interval !== undefined ? globals.autosave_interval : '';
        state.connectionMessages = globals.connection_messages !== 'false';
        state.logTypesExplicit = logTypes.length > 0;
        state.logTypes = logTypes.length > 0 ? logTypes : DEFAULT_LOG_TYPES.slice();

        state.passwordFile = globals.password_file || '';
        state.aclFile = globals.acl_file || '';
        for (const p of state.items.filter(i => i.type === 'plugin')) {
            if (p.path.endsWith('/mosquitto_password_file.so')) state.passwordFile = p.opts.password_file || PASSWD_FILE;
            if (p.path.endsWith('/mosquitto_acl_file.so')) state.aclFile = p.opts.acl_file || ACL_FILE;
        }

        // the certificate source is derived from the paths in use, unless the
        // user picked "custom" (its paths may still equal the addon's or CCU's)
        if (!state.customChosen) state.certSource = 'ccu';
        state.certfile = CCU_CERT;
        state.keyfile = CCU_CERT;
        state.tlsVersion = '';
        const tls = state.listeners.find(l => l.tls);
        if (tls) {
            state.certfile = tls.certfile;
            state.keyfile = tls.keyfile;
            if (state.customChosen) state.certSource = 'custom';
            else if (tls.certfile === CCU_CERT) state.certSource = 'ccu';
            else if (tls.certfile === ADDON_CERT) state.certSource = 'addon';
            else state.certSource = 'custom';
            const v = state.listeners.find(l => l.tls && l.tls_version);
            state.tlsVersion = v ? v.tls_version : '';
        }
    }

    function currentCert() {
        switch (state.certSource) {
            case 'ccu': return { certfile: CCU_CERT, keyfile: CCU_CERT };
            case 'addon': return { certfile: ADDON_CERT, keyfile: ADDON_KEY };
            default: return { certfile: state.certfile, keyfile: state.keyfile };
        }
    }

    // trailing blank line of a block: kept as it was in the file, always for a new block
    function withExtras(out, extras, isNew) {
        const rest = extras.slice();
        const hadBlank = rest.length > 0 && rest[rest.length - 1].trim() === '';
        while (rest.length && rest[rest.length - 1].trim() === '') rest.pop();
        out.push(...rest);
        if (hadBlank || isNew) out.push('');
        return out;
    }

    function listenerLines(l, isNew) {
        const out = ['listener ' + l.port + (l.bind ? ' ' + l.bind : '')];
        if (l.protocol === 'websockets') out.push('protocol websockets');
        if (l.tls) {
            const cert = currentCert();
            out.push('certfile ' + cert.certfile);
            out.push('keyfile ' + cert.keyfile);
            if (state.tlsVersion) out.push('tls_version ' + state.tlsVersion);
        }
        if (l.max_connections !== '' && l.max_connections !== undefined) out.push('max_connections ' + l.max_connections);
        return withExtras(out, l.extras, isNew);
    }

    function bridgeLines(b, isNew) {
        const out = ['connection ' + b.name];
        for (const key of BRIDGE_KEYS) {
            if (b[key] !== '' && b[key] !== undefined) out.push(key + ' ' + b[key]);
        }
        for (const t of b.topics) {
            if (t.trim()) out.push('topic ' + t.trim());
        }
        return withExtras(out, b.extras, isNew);
    }

    // what mosquitto assumes when a key is absent - such keys are only written
    // once their value differs, so a hand-written file is not padded with
    // defaults on every save
    const GLOBAL_DEFAULTS = { allow_anonymous: 'false', persistence: 'false', connection_messages: 'true' };

    function serialise() {
        const globals = {
            allow_anonymous: String(state.allowAnonymous),
            persistence: String(state.persistence),
            persistence_location: state.persistenceLocation || null,
            autosave_interval: state.autosaveInterval === '' ? null : String(state.autosaveInterval),
            connection_messages: String(state.connectionMessages),
            log_type: state.logTypesExplicit ? state.logTypes.slice() : null,
            password_file: null,   // legacy directives are rewritten as plugin blocks
            acl_file: null
        };
        const written = new Set();
        const out = [];
        const writeGlobal = key => {
            written.add(key);
            const v = globals[key];
            if (v === null) return;
            if (Array.isArray(v)) out.push(...v.map(t => 'log_type ' + t));
            else out.push(key + ' ' + v);
        };
        const pluginBlock = (path, optKey, optValue) => [`plugin ${path}`, `plugin_opt_${optKey} ${optValue}`, ''];
        const blank = () => { if (out.length && out[out.length - 1].trim() !== '') out.push(''); };
        let havePasswd = false;
        let haveAcl = false;

        for (const i of state.items) {
            if (i.type === 'line') {
                out.push(i.text);
            } else if (i.type === 'global') {
                if (!written.has(i.key)) writeGlobal(i.key);
            } else if (i.type === 'listener') {
                if (state.listeners.includes(i)) out.push(...listenerLines(i, false));
            } else if (i.type === 'bridge') {
                // a bridge without an address is not configured yet (just added on the page):
                // leave it out, Mosquitto rejects a connection without one
                if (state.bridges.includes(i) && i.address) out.push(...bridgeLines(i, false));
            } else if (i.type === 'plugin') {
                if (i.path.endsWith('/mosquitto_password_file.so')) {
                    if (state.passwordFile && !havePasswd) { out.push(...pluginBlock(PLUGIN_PASSWD, 'password_file', state.passwordFile)); havePasswd = true; }
                } else if (i.path.endsWith('/mosquitto_acl_file.so')) {
                    if (state.aclFile && !haveAcl) { out.push(...pluginBlock(PLUGIN_ACL, 'acl_file', state.aclFile)); haveAcl = true; }
                } else {
                    out.push(...i.lines);
                }
            }
        }
        // managed globals the file did not have yet
        const missing = ['allow_anonymous', 'persistence', 'persistence_location', 'autosave_interval', 'connection_messages', 'log_type']
            .filter(k => !written.has(k) && globals[k] !== null && globals[k] !== GLOBAL_DEFAULTS[k]);
        if (missing.length) {
            blank();
            missing.forEach(writeGlobal);
        }
        for (const l of state.listeners) {
            if (!state.items.includes(l)) { blank(); out.push(...listenerLines(l, true)); }
        }
        for (const b of state.bridges) {
            if (!state.items.includes(b) && b.address) { blank(); out.push(...bridgeLines(b, true)); }
        }
        if (state.passwordFile && !havePasswd) { blank(); out.push(...pluginBlock(PLUGIN_PASSWD, 'password_file', state.passwordFile)); }
        if (state.aclFile && !haveAcl) { blank(); out.push(...pluginBlock(PLUGIN_ACL, 'acl_file', state.aclFile)); }
        // collapse runs of blank lines
        const result = [];
        for (const line of out) {
            if (line.trim() === '' && result.length && result[result.length - 1].trim() === '') continue;
            result.push(line);
        }
        while (result.length && result[result.length - 1].trim() === '') result.pop();
        return result.join('\n') + '\n';
    }

    // loaded by node for the unit test: export the model, skip the page
    if (typeof document === 'undefined') {
        module.exports = { parse, load, serialise, state, currentCert, newListener, newBridge,
            PASSWD_FILE, ACL_FILE, PLUGIN_PASSWD, PLUGIN_ACL, CCU_CERT, ADDON_CERT, ADDON_KEY, VAR_DIR };
        return;
    }

    // =============================== the page ===============================

    const $ = sel => document.querySelector(sel);
    const $$ = sel => Array.from(document.querySelectorAll(sel));

    // --- session and http ------------------------------------------------------

    const sidMatch = location.search.match(/sid=(@[0-9a-zA-Z]{10}@)/);
    const sid = sidMatch ? sidMatch[1] : '';

    function invalidSession() {
        $('#invalidSession').style.display = 'block';
        clearTimeout(statusTimer);
    }

    async function get(url) {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (text.trim() === 'error: invalid session') {
            invalidSession();
            throw new Error('invalid session');
        }
        return text;
    }

    async function getJson(url) {
        const data = JSON.parse(await get(url));
        if (data && data.error === 'invalid session') {
            invalidSession();
            throw new Error('invalid session');
        }
        return data;
    }

    async function post(url, body) {
        const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (text.trim() === 'error: invalid session') {
            invalidSession();
            throw new Error('invalid session');
        }
        return text;
    }

    async function getJsonPost(url, body) {
        const data = JSON.parse(await post(url, body));
        if (data && data.error === 'invalid session') { invalidSession(); throw new Error('invalid session'); }
        return data;
    }

    function form(obj) {
        return Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
    }

    // --- ui helpers ---------------------------------------------------------------

    let toastTimer;
    function toast(message, type = 'success', timeout = 2500) {
        const el = $('#toast');
        el.textContent = message;
        el.className = 'alert alert-' + type;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), timeout);
    }

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (v !== undefined && v !== null) node.setAttribute(k, v);
        }
        for (const c of children) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return node;
    }

    function select(options, value, cls = 'w-md') {
        const node = el('select', { class: cls }, options.map(([v, text]) => el('option', { value: v, text })));
        node.value = value;
        return node;
    }

    // tabs
    function showTab(name) {
        $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
        $$('.navbar .tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
        if (name === 'licenses' && !$('#licenses-frame').src) {
            $('#licenses-frame').src = 'licenses.html';
        }
    }
    $$('.navbar .tabs a').forEach(a => a.addEventListener('click', e => {
        e.preventDefault();
        history.replaceState(null, '', '#' + a.dataset.tab);
        showTab(a.dataset.tab);
    }));
    showTab(['configuration', 'debug', 'licenses'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'configuration');

    // --- load / save ----------------------------------------------------------------

    async function loadConfig() {
        const text = await get('getconfig.cgi?sid=' + sid);
        load(text);
        render();
    }

    async function save() {
        const text = serialise();
        try {
            const result = (await post('setconfig.cgi?sid=' + sid, text)).trim();
            if (result === 'ok') {
                window.saveCount = (window.saveCount || 0) + 1;   // tests wait on this
                $('#apply-bar').classList.remove('hidden');
                // re-parse what was written so the items reflect the file
                load(text);
                renderListeners();
                renderBridges();
                renderFirewall();
            } else {
                toast(result.replace(/^error:\s*/, 'Nicht gespeichert: '), 'danger', 8000);
                await loadConfig();
            }
        } catch (e) {
            if (e.message !== 'invalid session') toast('Speichern fehlgeschlagen: ' + e.message, 'danger', 6000);
        }
    }

    // --- rendering --------------------------------------------------------------------

    function render() {
        renderListeners();
        renderBridges();
        renderFirewall();
        $('#cert-source').value = state.certSource;
        $('#cert-certfile').value = state.certSource === 'custom' ? state.certfile : '';
        $('#cert-keyfile').value = state.certSource === 'custom' ? state.keyfile : '';
        $('#tls-version').value = state.tlsVersion;
        renderCert();
        $('#allow-anonymous').value = String(state.allowAnonymous);
        $('#password-file').checked = !!state.passwordFile;
        $('#password-file-path').textContent = state.passwordFile || PASSWD_FILE;
        $('#acl-file').checked = !!state.aclFile;
        $('#acl-file-path').textContent = state.aclFile || ACL_FILE;
        renderAuth();
        $$('#log-types input').forEach(cb => { cb.checked = state.logTypes.includes(cb.value); });
        $('#connection-messages').checked = state.connectionMessages;
        $('#persistence').checked = state.persistence;
        $('#autosave-interval').value = state.autosaveInterval;
        renderPersistenceLocation();
    }

    // --- listeners --------------------------------------------------------------------

    function renderListeners() {
        const container = $('#listeners');
        container.innerHTML = '';
        if (!state.listeners.length) {
            container.appendChild(el('div', { class: 'alert alert-warning', text: 'Kein Listener konfiguriert - Mosquitto nimmt so keine Verbindungen an.' }));
        }
        state.listeners.forEach((l, idx) => {
            const port = el('input', { type: 'number', class: 'w-sm', min: 1, max: 65535, value: l.port, placeholder: 'Port' });
            const bind = el('input', { type: 'text', class: 'w-md', value: l.bind, placeholder: 'alle Adressen' });
            const protocol = select([['mqtt', 'MQTT'], ['websockets', 'WebSockets']], l.protocol === 'websockets' ? 'websockets' : 'mqtt');
            const tls = el('input', { type: 'checkbox' });
            tls.checked = l.tls;
            const maxConn = el('input', { type: 'number', class: 'w-sm', min: -1, value: l.max_connections, placeholder: 'unbegrenzt' });
            const remove = el('button', { type: 'button', class: 'btn btn-danger', text: 'Entfernen', onclick: () => {
                if (!confirm(`Listener auf Port ${l.port} entfernen?`)) return;
                state.listeners.splice(idx, 1);
                renderListeners();
                save();
            } });
            const apply = () => {
                const p = parseInt(port.value, 10);
                if (!(p >= 1 && p <= 65535)) { port.classList.add('is-invalid'); return; }
                port.classList.remove('is-invalid');
                l.port = String(p);
                l.bind = bind.value.trim();
                l.protocol = protocol.value;
                l.tls = tls.checked;
                l.max_connections = maxConn.value.trim();
                save();
            };
            [port, bind, protocol, tls, maxConn].forEach(i => i.addEventListener('change', apply));
            const extras = l.extras.filter(x => x.trim() && !x.trim().startsWith('#')).map(x => x.trim());
            const fw = el('span', { class: 'help fw-status', 'data-port': l.port });
            container.appendChild(el('div', { class: 'listener' }, [
                el('div', { class: 'form-row' }, [
                    el('label', { text: 'Port' }), port,
                    el('label', { text: 'Bind-Adresse' }), bind,
                    el('label', { text: 'Protokoll' }), protocol,
                    el('label', {}, [tls, 'TLS']),
                    el('label', { text: 'Max. Verbindungen', title: 'max_connections' }), maxConn,
                    fw,
                    el('span', { class: 'grow' }),
                    remove
                ]),
                extras.length
                    ? el('div', { class: 'help mb-2', text: 'Weitere Optionen aus der Datei (bleiben erhalten): ' + extras.join(', ') })
                    : el('span')
            ]));
        });
        applyFirewallStatus();
    }

    $('#listener-add').addEventListener('click', () => {
        const used = new Set(state.listeners.map(l => String(l.port)));
        const port = ['1883', '8883', '1884', '8884'].find(p => !used.has(p)) || '';
        const l = newListener(port);
        l.protocol = port === '8884' || port === '1884' ? 'websockets' : 'mqtt';
        l.tls = port.startsWith('88');
        state.listeners.push(l);
        renderListeners();
        if (port) save();
    });

    // --- firewall (task 13) ---------------------------------------------------------------

    let firewall = null; // {available, mode, userports}

    function blockedPorts() {
        if (!firewall || !firewall.available || firewall.mode === 'MOST_OPEN') return [];
        const open = new Set((firewall.userports || []).map(String));
        return state.listeners.map(l => String(l.port)).filter(p => p && !open.has(p));
    }

    function applyFirewallStatus() {
        $$('.fw-status').forEach(span => {
            const port = span.dataset.port;
            if (!firewall || !firewall.available) { span.textContent = ''; return; }
            const blocked = blockedPorts().includes(port);
            span.textContent = blocked ? 'Firewall: gesperrt' : 'Firewall: offen';
            span.style.color = blocked ? '#dc3545' : 'darkgreen';
        });
    }

    function renderFirewall() {
        const box = $('#firewall');
        if (!firewall || !firewall.available) { box.classList.add('hidden'); return; }
        box.classList.remove('hidden');
        const blocked = blockedPorts();
        if (firewall.mode === 'MOST_OPEN') {
            $('#firewall-text').textContent = 'CCU-Firewall im Modus MOST_OPEN: alle Ports erreichbar.';
        } else if (blocked.length) {
            $('#firewall-text').textContent = `CCU-Firewall im Modus ${firewall.mode}: Port${blocked.length > 1 ? 's' : ''} ${blocked.join(', ')} nicht freigegeben.`;
        } else {
            $('#firewall-text').textContent = `CCU-Firewall im Modus ${firewall.mode}: alle Listener-Ports sind freigegeben.`;
        }
        $('#firewall-open').classList.toggle('hidden', blocked.length === 0);
        applyFirewallStatus();
    }

    async function loadFirewall() {
        try {
            firewall = await getJson('firewall.cgi?cmd=status&sid=' + sid);
        } catch (e) {
            firewall = null;
        }
        renderFirewall();
    }

    $('#firewall-open').addEventListener('click', async () => {
        const ports = blockedPorts();
        if (!ports.length) return;
        $('#firewall-spinner').classList.remove('hidden');
        try {
            const data = await getJsonPost('firewall.cgi?cmd=open&sid=' + sid, form({ ports: ports.join(',') }));
            if (data.error) toast(data.error, 'danger', 6000);
            else { firewall = data; toast('Ports ' + ports.join(', ') + ' in der CCU-Firewall freigegeben'); }
        } catch (e) {
            if (e.message !== 'invalid session') toast('Fehler: ' + e.message, 'danger');
        }
        $('#firewall-spinner').classList.add('hidden');
        renderFirewall();
    });

    // --- bridges (task 11) ------------------------------------------------------------------

    function renderBridges() {
        const container = $('#bridges');
        container.innerHTML = '';
        state.bridges.forEach((b, idx) => {
            const name = el('input', { type: 'text', class: 'w-md', value: b.name, placeholder: 'Name' });
            const address = el('input', { type: 'text', class: 'grow', value: b.address, placeholder: 'host:port [host:port ...]' });
            const user = el('input', { type: 'text', class: 'w-md', value: b.remote_username, placeholder: 'Benutzer (optional)', autocomplete: 'off' });
            const pass = el('input', { type: 'password', class: 'w-md', value: b.remote_password, placeholder: 'Passwort', autocomplete: 'new-password' });
            const clientid = el('input', { type: 'text', class: 'w-md', value: b.remote_clientid, placeholder: 'Client-ID (optional)' });
            const version = select([['', 'MQTT 3.1.1 (Standard)'], ['mqttv50', 'MQTT 5'], ['mqttv311', 'MQTT 3.1.1'], ['mqttv31', 'MQTT 3.1']], b.bridge_protocol_version);
            const clean = el('input', { type: 'checkbox' });
            clean.checked = b.cleansession === 'true';
            const notifications = el('input', { type: 'checkbox' });
            notifications.checked = b.notifications !== 'false';
            const tryPrivate = el('input', { type: 'checkbox' });
            tryPrivate.checked = b.try_private !== 'false';
            const cafile = el('input', { type: 'text', class: 'grow', value: b.bridge_cafile, placeholder: 'leer = ohne TLS, sonst Pfad zur CA-Datei (PEM)' });
            const insecure = el('input', { type: 'checkbox' });
            insecure.checked = b.bridge_insecure === 'true';
            const topics = el('textarea', { class: 'grow', rows: Math.max(2, b.topics.length + 1), placeholder: '# both 0' });
            topics.value = b.topics.join('\n');
            const remove = el('button', { type: 'button', class: 'btn btn-danger', text: 'Entfernen', onclick: () => {
                if (!confirm(`Bridge ${b.name} entfernen?`)) return;
                state.bridges.splice(idx, 1);
                renderBridges();
                save();
            } });
            const apply = () => {
                const n = name.value.trim();
                const nameOk = /^[^\s#]+$/.test(n);
                name.classList.toggle('is-invalid', !nameOk);
                const a = address.value.trim();
                address.classList.toggle('is-invalid', !a);
                if (!nameOk || !a) return;
                b.name = n;
                b.address = a;
                b.remote_username = user.value.trim();
                b.remote_password = pass.value;
                b.remote_clientid = clientid.value.trim();
                b.bridge_protocol_version = version.value;
                b.cleansession = clean.checked ? 'true' : '';
                b.notifications = notifications.checked ? '' : 'false';
                b.try_private = tryPrivate.checked ? '' : 'false';
                b.bridge_cafile = cafile.value.trim();
                b.bridge_insecure = b.bridge_cafile && insecure.checked ? 'true' : '';
                b.topics = topics.value.split('\n').map(t => t.trim()).filter(Boolean);
                save();
            };
            [name, address, user, pass, clientid, version, clean, notifications, tryPrivate, cafile, insecure, topics]
                .forEach(i => i.addEventListener('change', apply));
            const extras = b.extras.filter(x => x.trim() && !x.trim().startsWith('#')).map(x => x.trim());
            container.appendChild(el('div', { class: 'listener' }, [
                el('div', { class: 'form-row' }, [el('label', { text: 'Name' }), name, el('label', { text: 'Adresse' }), address, remove]),
                el('div', { class: 'form-row' }, [el('label', { text: 'Login' }), user, pass, clientid, version]),
                el('div', { class: 'form-row' }, [
                    el('label', {}, [clean, 'Clean Session']),
                    el('label', {}, [notifications, 'Status-Nachrichten ($SYS/broker/connection/…)']),
                    el('label', {}, [tryPrivate, 'try_private'])
                ]),
                el('div', { class: 'form-row' }, [el('label', { text: 'TLS CA-Datei' }), cafile, el('label', {}, [insecure, 'Hostnamen nicht prüfen (bridge_insecure)'])]),
                el('div', { class: 'form-row' }, [el('label', { text: 'Topics', style: 'align-self: flex-start' }), topics]),
                extras.length
                    ? el('div', { class: 'help mb-2', text: 'Weitere Optionen aus der Datei (bleiben erhalten): ' + extras.join(', ') })
                    : el('span')
            ]));
        });
    }

    $('#bridge-add').addEventListener('click', () => {
        const used = new Set(state.bridges.map(b => b.name));
        let n = 1;
        while (used.has('bridge' + n)) n += 1;
        const b = newBridge('bridge' + n);
        b.topics = ['# both 0'];
        state.bridges.push(b);
        renderBridges();
        // saved once the address is filled in (apply on change)
    });

    // --- certificate ----------------------------------------------------------------------

    function renderCert() {
        $('#cert-custom').classList.toggle('hidden', state.certSource !== 'custom');
        $('#cert-generate').classList.toggle('hidden', state.certSource !== 'addon');
        const cert = currentCert();
        const info = $('#cert-info');
        if (!cert.certfile) { info.classList.add('hidden'); return; }
        get(`cert.cgi?cmd=info&sid=${sid}&file=${encodeURIComponent(cert.certfile)}`).then(text => {
            info.textContent = cert.certfile + '\n' + text.trim();
            info.classList.remove('hidden');
        }).catch(() => info.classList.add('hidden'));
    }

    $('#cert-source').addEventListener('change', () => {
        state.certSource = $('#cert-source').value;
        state.customChosen = state.certSource === 'custom';
        if (state.certSource === 'custom') {
            // start from the paths in use, so the inputs show what gets written
            $('#cert-certfile').value = state.certfile;
            $('#cert-keyfile').value = state.keyfile;
        }
        renderCert();
        if (state.certSource !== 'custom' || (state.certfile && state.keyfile)) save();
    });
    ['#cert-certfile', '#cert-keyfile'].forEach(sel => $(sel).addEventListener('change', () => {
        state.certfile = $('#cert-certfile').value.trim();
        state.keyfile = $('#cert-keyfile').value.trim();
        renderCert();
        if (state.certfile && state.keyfile) save();
    }));
    $('#tls-version').addEventListener('change', () => {
        state.tlsVersion = $('#tls-version').value;
        save();
    });
    $('#cert-generate').addEventListener('click', async () => {
        if (!confirm('Ein neues selbstsigniertes Zertifikat erzeugen? Ein vorhandenes in etc/certs/ wird ersetzt.')) return;
        $('#cert-spinner').classList.remove('hidden');
        try {
            const result = (await post('cert.cgi?cmd=generate&sid=' + sid, form({ cn: '' }))).trim();
            if (result === 'ok') {
                toast('Zertifikat erzeugt');
                renderCert();
                if (state.listeners.some(l => l.tls)) $('#apply-bar').classList.remove('hidden');
            } else {
                toast(result, 'danger', 8000);
            }
        } catch (e) {
            toast('Fehler: ' + e.message, 'danger');
        }
        $('#cert-spinner').classList.add('hidden');
    });

    // --- authentication ---------------------------------------------------------------------

    function renderAuth() {
        $('#auth-warning').classList.toggle('hidden', state.allowAnonymous || !!state.passwordFile);
        const foreign = !!state.passwordFile && state.passwordFile !== PASSWD_FILE;
        $('#password-file-foreign').classList.toggle('hidden', !foreign);
        $('#users-block').classList.toggle('hidden', !state.passwordFile || foreign);
        if (state.passwordFile && !foreign) loadUsers();
    }

    $('#allow-anonymous').addEventListener('change', () => {
        state.allowAnonymous = $('#allow-anonymous').value === 'true';
        renderAuth();
        save();
    });
    $('#password-file').addEventListener('change', () => {
        state.passwordFile = $('#password-file').checked ? PASSWD_FILE : '';
        $('#password-file-path').textContent = state.passwordFile || PASSWD_FILE;
        renderAuth();
        save();
    });
    $('#acl-file').addEventListener('change', () => {
        state.aclFile = $('#acl-file').checked ? ACL_FILE : '';
        $('#acl-file-path').textContent = state.aclFile || ACL_FILE;
        save();
    });

    function renderUsers(users) {
        const table = $('#users');
        table.innerHTML = '';
        if (!users.length) {
            table.appendChild(el('tr', {}, [el('td', { class: 'text-muted', text: 'Noch keine Benutzer in der Passwortdatei.' })]));
        }
        for (const name of users) {
            table.appendChild(el('tr', {}, [
                el('td', { text: name }),
                el('td', {}, [
                    el('button', { type: 'button', class: 'btn btn-outline mr-2', text: 'Passwort ändern', onclick: () => { $('#user-name').value = name; $('#user-pass1').focus(); } }),
                    el('button', { type: 'button', class: 'btn btn-danger', text: 'Löschen', onclick: async () => {
                        if (!confirm(`Benutzer ${name} löschen?`)) return;
                        try {
                            const data = await getJsonPost('passwd.cgi?cmd=delete&sid=' + sid, form({ user: name }));
                            if (data.error) toast(data.error, 'danger', 6000);
                            else { toast(`Benutzer ${name} gelöscht`); renderUsers(data.users); }
                        } catch (e) {
                            if (e.message !== 'invalid session') toast('Fehler: ' + e.message, 'danger');
                        }
                    } })
                ])
            ]));
        }
    }

    async function loadUsers() {
        try {
            const data = await getJson('passwd.cgi?cmd=list&sid=' + sid);
            renderUsers(data.users || []);
        } catch (e) { /* session error already shown */ }
    }

    $('#user-set').addEventListener('click', async () => {
        const name = $('#user-name').value.trim();
        const pw1 = $('#user-pass1').value;
        const pw2 = $('#user-pass2').value;
        const nameOk = /^[A-Za-z0-9._@+-]{1,64}$/.test(name);
        const pwOk = pw1.length > 0 && pw1 === pw2;
        $('#user-name').classList.toggle('is-invalid', !nameOk);
        $('#user-pass1').classList.toggle('is-invalid', !pwOk);
        $('#user-pass2').classList.toggle('is-invalid', !pwOk);
        if (!nameOk || !pwOk) return;
        try {
            const data = await getJsonPost('passwd.cgi?cmd=set&sid=' + sid, form({ user: name, password: pw1 }));
            if (data.error) { toast(data.error, 'danger', 6000); return; }
            toast(`Passwort für ${name} gesetzt`);
            $('#user-name').value = '';
            $('#user-pass1').value = '';
            $('#user-pass2').value = '';
            renderUsers(data.users);
        } catch (e) {
            if (e.message !== 'invalid session') toast('Fehler: ' + e.message, 'danger');
        }
    });

    // --- logging, persistence -------------------------------------------------------------

    $$('#log-types input').forEach(cb => cb.addEventListener('change', () => {
        state.logTypes = $$('#log-types input').filter(c => c.checked).map(c => c.value);
        state.logTypesExplicit = true;
        save();
    }));
    $('#connection-messages').addEventListener('change', () => {
        state.connectionMessages = $('#connection-messages').checked;
        save();
    });
    $('#persistence').addEventListener('change', () => {
        state.persistence = $('#persistence').checked;
        save();
    });

    // --- persistence location (task 15): addon dir, a mounted USB stick or a custom path ---

    let media = []; // [{path, fs, free_mb}] from media.cgi

    function locationKind(loc) {
        const norm = (loc || '').replace(/\/+$/, '');
        if (!norm || norm === VAR_DIR.replace(/\/$/, '')) return 'var';
        if (media.some(m => norm === m.path || norm.startsWith(m.path + '/'))) return norm;
        return 'custom';
    }

    // the directory used on a stick: a subdirectory, so several addons can share it
    const stickDir = mp => mp + '/mosquitto/';

    function renderPersistenceLocation() {
        const sel = $('#persistence-location');
        sel.innerHTML = '';
        sel.appendChild(el('option', { value: 'var', text: 'Addon-Verzeichnis (' + VAR_DIR + ')' }));
        for (const m of media) {
            sel.appendChild(el('option', { value: m.path, text: `USB-Stick ${m.path} (${m.fs}, ${m.free_mb} MB frei)` }));
        }
        sel.appendChild(el('option', { value: 'custom', text: 'Eigener Pfad' }));
        const kind = locationKind(state.persistenceLocation);
        // a stick that is configured but not plugged in: keep it selectable, flagged
        if (kind === 'custom' && /^\/media\/[^/]+/.test(state.persistenceLocation)) {
            const mp = state.persistenceLocation.match(/^\/media\/[^/]+/)[0];
            sel.appendChild(el('option', { value: mp, text: `USB-Stick ${mp} (nicht eingehängt)` }));
            sel.value = mp;
        } else {
            sel.value = kind;
        }
        $('#persistence-location-custom').classList.toggle('hidden', sel.value !== 'custom');
        $('#persistence-location-custom').value = kind === 'custom' ? state.persistenceLocation : '';
        checkPersistenceLocation();
    }

    async function checkPersistenceLocation() {
        const status = $('#persistence-location-status');
        const loc = state.persistenceLocation || VAR_DIR;
        try {
            const c = await getJson(`media.cgi?cmd=check&sid=${sid}&file=${encodeURIComponent(loc)}`);
            if (c.error) { status.textContent = ''; return; }
            if (!c.mounted) {
                status.innerHTML = `<span style="color:#dc3545">${loc}: kein USB-Stick eingehängt - Mosquitto kann dort nicht speichern.</span>`;
            } else if (!c.exists) {
                status.textContent = `${loc}: Verzeichnis fehlt, wird beim Start von Mosquitto angelegt.`;
            } else if (!c.writable) {
                status.innerHTML = `<span style="color:#dc3545">${loc}: nicht beschreibbar.</span>`;
            } else {
                status.textContent = `${loc}: ${c.fs || ''} ${c.free_mb} MB frei`;
            }
        } catch (e) {
            status.textContent = '';
        }
    }

    async function loadMedia() {
        try {
            const data = await getJson('media.cgi?cmd=list&sid=' + sid);
            media = data.media || [];
        } catch (e) {
            media = [];
        }
        renderPersistenceLocation();
    }

    $('#persistence-location').addEventListener('change', () => {
        const v = $('#persistence-location').value;
        $('#persistence-location-custom').classList.toggle('hidden', v !== 'custom');
        if (v === 'var') state.persistenceLocation = VAR_DIR;
        else if (v === 'custom') { $('#persistence-location-custom').focus(); return; }
        else state.persistenceLocation = stickDir(v);
        checkPersistenceLocation();
        save();
    });
    $('#persistence-location-custom').addEventListener('change', () => {
        let v = $('#persistence-location-custom').value.trim();
        if (!v.startsWith('/')) { $('#persistence-location-custom').classList.add('is-invalid'); return; }
        $('#persistence-location-custom').classList.remove('is-invalid');
        if (!v.endsWith('/')) v += '/';
        state.persistenceLocation = v;
        checkPersistenceLocation();
        save();
    });
    $('#persistence-location-refresh').addEventListener('click', loadMedia);
    $('#autosave-interval').addEventListener('change', () => {
        const v = $('#autosave-interval').value.trim();
        state.autosaveInterval = v === '' ? '' : String(Math.max(0, parseInt(v, 10) || 0));
        $('#autosave-interval').value = state.autosaveInterval;
        save();
    });

    // --- process control and status ---------------------------------------------------

    let statusTimer;
    let busy = false;

    function setButtons(running) {
        $('#btn-restart').disabled = busy || !running;
        $('#btn-stop').disabled = busy || !running;
        $('#btn-reload').disabled = busy || !running;
        $('#btn-start').disabled = busy || running;
    }

    function formatSince(epoch) {
        const d = new Date(epoch * 1000);
        return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    async function pollStatus() {
        clearTimeout(statusTimer);
        try {
            const s = await getJson('service.cgi?cmd=status');
            $('#status-spinner').classList.add('hidden');
            if (s.running) {
                $('#status').innerHTML = `<span class="status-running">running</span> (seit ${formatSince(s.since)})`;
                $('#status-detail').textContent = `pid ${s.pid}, rss ${(s.rss_kb / 1024).toFixed(1)} MB, vsz ${(s.vsz_kb / 1024).toFixed(1)} MB`;
                $('#status-error').classList.add('hidden');
                setButtons(true);
            } else {
                $('#status').innerHTML = '<span class="status-stopped">stopped</span>';
                $('#status-detail').textContent = '';
                if (s.lastError) {
                    $('#status-error').textContent = 'Letzte Fehlermeldung von Mosquitto: ' + s.lastError;
                    $('#status-error').classList.remove('hidden');
                }
                setButtons(false);
            }
        } catch (e) {
            $('#status').innerHTML = '<span class="status-starting">unbekannt</span>';
            $('#status-detail').textContent = '';
        }
        statusTimer = setTimeout(pollStatus, 5000);
    }

    async function service(cmd, label) {
        busy = true;
        setButtons(false);
        $('#status-spinner').classList.remove('hidden');
        $('#status').innerHTML = `<span class="status-starting">${label} ...</span>`;
        $('#status-detail').textContent = '';
        try {
            const result = await get(`service.cgi?cmd=${cmd}&sid=${sid}`);
            if (/OK/.test(result)) {
                toast('Kommando ausgeführt');
                if (cmd === 'restart' || cmd === 'start') $('#apply-bar').classList.add('hidden');
            } else {
                toast(result.trim() || 'Fehler', 'danger', 6000);
            }
        } catch (e) {
            if (e.message !== 'invalid session') toast('Fehler: ' + e.message, 'danger');
        }
        busy = false;
        setTimeout(pollStatus, 1500);
    }

    $('#btn-restart').addEventListener('click', () => service('restart', 'Neustart'));
    $('#apply-restart').addEventListener('click', () => service('restart', 'Neustart'));
    $('#btn-stop').addEventListener('click', () => service('stop', 'stopping'));
    $('#btn-start').addEventListener('click', () => service('start', 'starting'));
    $('#btn-reload').addEventListener('click', () => service('reload', 'reload'));

    // --- versions and update check ----------------------------------------------------

    // true if version a is newer than b, versions are <x.y.z>+<build>
    function isNewer(a, b) {
        const parseVersion = v => {
            const [main, build] = String(v).split('+');
            return { parts: main.split('.').map(Number), build: parseInt(build || '0', 10) };
        };
        const va = parseVersion(a);
        const vb = parseVersion(b);
        for (let i = 0; i < 3; i++) {
            if ((va.parts[i] || 0) !== (vb.parts[i] || 0)) return (va.parts[i] || 0) > (vb.parts[i] || 0);
        }
        return va.build > vb.build;
    }

    let currentVersion = '';
    let availableVersion = '';

    async function checkUpdate() {
        try {
            const v = await getJson('service.cgi?cmd=versions');
            currentVersion = v.VERSION_ADDON || '';
            $('#addon-version').textContent = `ccu-addon-mosquitto ${currentVersion} · Mosquitto ${v.MOSQUITTO_VERSION || ''}`;
            const table = $('#versions');
            table.innerHTML = '';
            for (const [key, value] of Object.entries(v)) {
                table.appendChild(el('tr', {}, [el('td', { text: key }), el('td', {}, [el('code', { text: value })])]));
            }
            const available = (await get('update_check.cgi?sid=' + sid)).trim();
            if (available !== 'n/a' && isNewer(available, currentVersion)) {
                availableVersion = available;
                $('#update-link').innerHTML = `<a href="https://github.com/homematic-community/ccu-addon-mosquitto/releases/latest" target="_blank">Version ${available}</a>`;
                $('#update-notify').classList.remove('hidden');
            } else {
                availableVersion = '';
                $('#update-notify').classList.add('hidden');
            }
        } catch (e) { /* offline or session error */ }
    }

    // --- self-update ------------------------------------------------------------------------

    const modal = $('#modal-update');
    let updateTimer;
    let updatePollFailures = 0;

    function updateView(view) {
        $('#update-confirm').classList.toggle('hidden', view !== 'confirm');
        $('#update-progress').classList.toggle('hidden', view !== 'progress');
        $('#update-result').classList.toggle('hidden', view !== 'result');
        $('#update-cancel').classList.toggle('hidden', view !== 'confirm');
        $('#update-go').classList.toggle('hidden', view !== 'confirm');
        $('#update-close').classList.toggle('hidden', view !== 'result');
        $('#update-reload').classList.toggle('hidden', view !== 'result');
    }

    function renderUpdate(s) {
        if (s.version) $('#update-version').textContent = s.version;
        if (s.phase === 'error') {
            updateView('result');
            $('#update-success').classList.add('hidden');
            $('#update-error').textContent = s.error || s.message || 'Unbekannter Fehler';
            $('#update-error').classList.remove('hidden');
            $('#update-reload').classList.add('hidden');
            get('update.cgi?cmd=log&sid=' + sid).then(log => {
                $('#update-log').textContent = log;
                $('#update-log').classList.remove('hidden');
            }).catch(() => {});
            checkUpdate();
            return;
        }
        if (s.phase === 'done') {
            updateView('result');
            $('#update-error').classList.add('hidden');
            $('#update-log').classList.add('hidden');
            $('#update-success').textContent = s.message;
            $('#update-success').classList.remove('hidden');
            checkUpdate();
            return;
        }
        updateView('progress');
        $('#update-message').textContent = s.message || '';
        const age = s.ts ? Math.round(Date.now() / 1000 - s.ts) : 0;
        if (updatePollFailures > 2) $('#update-hint').textContent = 'Keine Verbindung zur Zentrale, versuche weiter ...';
        else if (age > 120) $('#update-hint').textContent = `Seit ${age} Sekunden keine Rückmeldung des Updaters. Falls das so bleibt: Log im Debug-Tab / syslog prüfen.`;
        else if (s.phase === 'install') $('#update-hint').textContent = 'Mosquitto ist während der Installation gestoppt. Bitte die Zentrale jetzt nicht neu starten.';
        else $('#update-hint').textContent = '';
    }

    async function pollUpdate() {
        clearTimeout(updateTimer);
        try {
            const s = await getJson('update.cgi?cmd=status');
            updatePollFailures = 0;
            renderUpdate(s);
            if (!['done', 'error', 'idle'].includes(s.phase)) updateTimer = setTimeout(pollUpdate, 1500);
        } catch (e) {
            // the CGI can be unreachable for a moment while the tree is replaced
            updatePollFailures += 1;
            if (updatePollFailures > 2) $('#update-hint').textContent = 'Keine Verbindung zur Zentrale, versuche weiter ...';
            updateTimer = setTimeout(pollUpdate, 3000);
        }
    }

    $('#update-start').addEventListener('click', () => {
        $('#update-version').textContent = availableVersion;
        $('#update-error').classList.add('hidden');
        $('#update-success').classList.add('hidden');
        $('#update-log').classList.add('hidden');
        updateView('confirm');
        modal.classList.remove('hidden');
    });
    $('#update-go').addEventListener('click', async () => {
        updateView('progress');
        $('#update-message').textContent = 'Update wird gestartet ...';
        $('#update-hint').textContent = '';
        try {
            const s = await getJson('update.cgi?cmd=start&sid=' + sid);
            if (s.error) { renderUpdate({ phase: 'error', error: s.error }); return; }
            updateTimer = setTimeout(pollUpdate, 1000);
        } catch (e) {
            renderUpdate({ phase: 'error', error: 'Das Update konnte nicht gestartet werden (update.cgi nicht erreichbar).' });
        }
    });
    const closeModal = () => {
        modal.classList.add('hidden');
        clearTimeout(updateTimer);
        get('update.cgi?cmd=reset&sid=' + sid).catch(() => {});
    };
    $('#update-cancel').addEventListener('click', closeModal);
    $('#update-close').addEventListener('click', closeModal);
    $('#update-reload').addEventListener('click', () => location.reload());

    // an update started earlier (page reloaded meanwhile?) - pick it up
    getJson('update.cgi?cmd=status').then(s => {
        if (s && s.phase && !['idle', 'done', 'error'].includes(s.phase)) {
            renderUpdate(s);
            modal.classList.remove('hidden');
            updateTimer = setTimeout(pollUpdate, 1000);
        }
    }).catch(() => {});

    // --- debug -------------------------------------------------------------------------------

    $('#log-download').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = 'log.cgi?sid=' + sid;
        a.download = 'mosquitto.' + new Date().toISOString() + '.log';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // --- go ----------------------------------------------------------------------------------

    loadConfig()
        .then(loadFirewall)
        .then(loadMedia)
        .catch(e => { if (e.message !== 'invalid session') toast('Konfiguration konnte nicht geladen werden: ' + e.message, 'danger', 8000); });
    pollStatus();
    checkUpdate();
})();
