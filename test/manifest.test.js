// The openccu-lite manifest (addon_files/openccu-lite.json): the file build_addon.sh puts at the
// root of the package, beside update_script, and that openccu-lite reads before update_script runs.
// The CCU3 and OpenCCU ignore it. What is checked here is what the platform refuses: the format,
// the id (the rc.d name update_script links), the release source it resolves the packages from.
//
//   node --test test/manifest.test.js   (or npm run test:unit)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'addon_files');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'openccu-lite.json'), 'utf8'));
const updateScript = fs.readFileSync(path.join(root, 'update_script'), 'utf8');

test('the manifest names this addon', () => {
    assert.equal(manifest.format, 1);
    assert.match(manifest.id, /^[a-z0-9][a-z0-9_.-]{0,31}$/);
    // the id is the rc.d name update_script links (ADDON_DIR=$ADDONS_DIR/mosquitto)
    assert.equal(manifest.id, 'mosquitto');
    assert.match(updateScript, /^ADDON_DIR=\$ADDONS_DIR\/mosquitto$/m);
    assert.ok(manifest.name && manifest.name.length > 0);
});

test('the release source is this repository and its asset names', () => {
    assert.equal(manifest.release.github, 'homematic-community/ccu-addon-mosquitto');
    assert.equal(manifest.release.asset, 'mosquitto-{arch}-{version}.tar.gz');
    assert.equal(manifest.release.fallback_asset, 'mosquitto-{version}.tar.gz');
});

test('the runtime block declares the broker ports and nothing it does not need', () => {
    assert.deepEqual(manifest.runtime.ports, [1883, 8883]);
    assert.deepEqual(Object.keys(manifest.runtime.port_info).sort(), ['1883', '8883']);
    assert.deepEqual(manifest.runtime.needs, []);
    assert.equal(manifest.runtime.root, undefined);
    // the logo the manifest names is part of the package
    assert.ok(fs.existsSync(path.join(root, manifest.ui.logo)), manifest.ui.logo);
});
