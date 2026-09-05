// Playwright helpers for the settings page tests (webui.test.js). Actions go
// through the DOM (click(), value + change event) rather than playwright's
// actionability checks, which hang on some headless chromium builds; the
// page's own handlers run either way.

const { chromium } = require('playwright');

async function openBrowser() {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    return browser;
}

// open the settings page with the session; collects page errors, console
// errors and HTTP errors in page.problems, starts JS coverage
async function openSettings(browser, url) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.problems = [];
    page.on('pageerror', e => page.problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') page.problems.push('console.error: ' + m.text()); });
    page.on('response', r => { if (r.status() >= 400) page.problems.push(`http ${r.status()}: ${r.url()}`); });
    page.on('dialog', d => d.accept());
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return page;
}

const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent.trim(), sel);
const value = (page, sel) => page.evaluate(s => document.querySelector(s)?.value, sel);
const checked = (page, sel) => page.evaluate(s => !!document.querySelector(s)?.checked, sel);
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; }, sel);
const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
const disabled = (page, sel) => page.evaluate(s => !!document.querySelector(s)?.disabled, sel);
const click = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('no element ' + s); e.click(); }, sel);
// set a value and fire change (what the page listens to)
const setValue = (page, sel, v) => page.evaluate(([s, v]) => { const e = document.querySelector(s); if (!e) throw new Error('no element ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
// a checkbox: click only when the state differs
const setChecked = async (page, sel, on) => { if ((await checked(page, sel)) !== on) await click(page, sel); };

// wait until fn() (evaluated in the page) is truthy
async function until(page, fn, what, timeout = 15000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try {
            if (await page.evaluate(fn, arg)) return;
        } catch (e) {
            if (!/Execution context was destroyed|navigation/.test(e.message)) throw e;   // a reload in progress
        }
        await page.waitForTimeout(250);
    }
    throw new Error(`timeout waiting for ${what}`);
}

// the settings page saves on change and counts successful saves in
// window.saveCount; wait for the next one (race free even with overlapping saves)
const saveCount = page => page.evaluate(() => window.saveCount || 0);
async function waitSavedAfter(page, before) {
    try {
        await until(page, b => (window.saveCount || 0) > b, 'the next save', 15000, before);
    } catch (e) {
        const toast = await page.evaluate(() => document.querySelector('#toast')?.textContent.trim());
        throw new Error(`${e.message} (toast: "${toast}")`);
    }
}
async function change(page, sel, v) { const n = await saveCount(page); await setValue(page, sel, v); await waitSavedAfter(page, n); }
async function clickSaved(page, sel) { const n = await saveCount(page); await click(page, sel); await waitSavedAfter(page, n); }
async function checkSaved(page, sel, on) { if ((await checked(page, sel)) === on) return; const n = await saveCount(page); await setChecked(page, sel, on); await waitSavedAfter(page, n); }
async function waitSaved(page) { await until(page, () => !document.querySelector('#apply-bar').classList.contains('hidden'), 'the apply bar'); }

// Chromium's precise coverage only reports scripts that are still alive: take a
// snapshot before every reload and start again (the caller keeps the snapshots)
async function collectCoverage(page) {
    const entries = await page.coverage.stopJSCoverage();
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    return entries;
}
async function reload(page, sink) {
    sink.push(await collectCoverage(page));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
}

// wait until a button is enabled (the page disables the process buttons while a command runs)
async function enabled(page, sel) { await until(page, s => !document.querySelector(s).disabled, `${sel} enabled`, 15000, sel); }

// click the apply bar's restart and wait for the running status
async function restartFromPage(page) {
    await click(page, '#apply-restart');
    await until(page, () => /running/.test(document.querySelector('#status').textContent) && document.querySelector('#apply-bar').classList.contains('hidden'), 'running after restart', 30000);
}

// V8 precise coverage of one script, merged over several coverage entry lists
// (pages). Per entry all ranges are applied largest first, so an inner block
// with count 0 overrides the enclosing function's count; the pages are OR-ed.
function coverageOf(entryLists, urlPart) {
    const entries = entryLists.flat().filter(e => e.url.includes(urlPart));
    if (!entries.length) return null;
    const total = entries[0].source.length;
    const bytes = new Uint8Array(total);
    const called = new Set();
    const seen = new Set();
    for (const entry of entries) {
        const page = new Uint8Array(total);
        const ranges = [];
        for (const fn of entry.functions) {
            const name = fn.functionName || `anonymous@${fn.ranges[0].startOffset}`;
            seen.add(name);
            if (fn.ranges[0].count > 0) called.add(name);
            ranges.push(...fn.ranges);
        }
        ranges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
        for (const r of ranges) page.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
        for (let i = 0; i < total; i++) if (page[i]) bytes[i] = 1;
    }
    let covered = 0;
    for (const b of bytes) covered += b;
    const uncalled = [...seen].filter(n => !called.has(n));
    return { covered, total, percent: Math.round(1000 * covered / total) / 10, uncalled };
}

module.exports = { openBrowser, openSettings, text, value, checked, visible, count, disabled, click, setValue, setChecked, until, waitSaved, change, clickSaved, checkSaved, enabled, collectCoverage, reload, restartFromPage, coverageOf };
