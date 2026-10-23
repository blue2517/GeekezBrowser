const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
// Use the same ASAR implementation as electron-builder.
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const asar = builderRequire('@electron/asar');
const { findChromiumExecutable } = require('../src/main/chromium-path.js');

const unpacked = path.resolve(process.argv[2] || 'dist/win-unpacked');
const resources = path.join(unpacked, 'resources');
const archive = path.join(resources, 'app.asar');
const entries = new Set(asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
for (const prefix of ['resources/bin', 'resources/puppeteer', 'tests', 'scripts', 'docs']) {
    assert.ok(![...entries].some(entry => entry === prefix || entry.startsWith(`${prefix}/`)),
        `Unexpected duplicate/development resources in app.asar: ${prefix}`);
}
for (const entry of ['package.json', 'out/main/index.js', 'out/main/chromium-path.js',
    'out/preload/index.js', 'out/renderer/index.html', 'resources/logo.ico']) {
    assert.ok(entries.has(entry), `Missing runtime file: ${entry}`);
}

const chrome = findChromiumExecutable({
    isDev: false, resourcesPath: resources, platform: 'win32', env: {}
});
assert.equal(chrome.source, 'bundled', 'Packaged Chromium must resolve without a system installation');
assert.ok(fs.statSync(chrome.executablePath).size > 0);
const xray = path.join(resources, 'bin', 'win32-x64', 'xray.exe');
assert.ok(fs.statSync(xray).size > 0, 'Missing external Xray executable');
for (const name of ['geoip.dat', 'geosite.dat']) {
    assert.ok(fs.statSync(path.join(resources, 'bin', name)).size > 0, `Missing ${name}`);
}
const version = spawnSync(xray, ['version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
assert.ifError(version.error);
assert.equal(version.status, 0, version.stdout + version.stderr);

const dist = path.dirname(unpacked);
const packages = fs.readdirSync(dist).filter(name => /\.(exe|zip)$/i.test(name));
assert.ok(packages.some(name => name.endsWith('.exe')), 'Missing installer');
assert.ok(packages.some(name => name.endsWith('.zip')), 'Missing portable package');
const rows = [
    ['app.asar (uncompressed)', fs.statSync(archive).size],
    ...packages.map(name => [name, fs.statSync(path.join(dist, name)).size])
];
const report = [
    '## Windows package verification',
    '',
    'PASS: Chrome and Xray are external only; runtime entries and bundled Chrome resolution verified.',
    `Xray: ${version.stdout.split(/\r?\n/)[0]}`,
    '',
    '| File | Bytes | MiB |',
    '| --- | ---: | ---: |',
    ...rows.map(([name, size]) => `| ${name} | ${size} | ${(size / 1024 / 1024).toFixed(2)} |`),
    ''
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
