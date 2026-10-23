import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const filter = new FileMatcher(root, path.join(root, 'dist'), value => value, build.files).createFilter();
const includes = (name, directory = false) => filter(path.join(root, name), { isDirectory: () => directory });

test('Chrome and proxy resources are excluded from app.asar, including directory roots', () => {
    for (const dir of ['resources/bin', 'resources/puppeteer', 'tests', 'scripts', 'docs']) {
        assert.equal(includes(dir, true), false, dir);
        assert.equal(includes(`${dir}/nested/example.dat`), false, dir);
    }
});

test('runtime code, dependencies, icons and licenses remain included', () => {
    for (const name of [
        'out/main/index.js', 'out/main/chromium-path.js', 'out/preload/index.js',
        'out/renderer/index.html', 'out/renderer/assets/main.js',
        'node_modules/sql.js/dist/sql-wasm.wasm', 'resources/logo.ico',
        'resources/logo.svg', 'src/renderer/icon.png', 'package.json', 'LICENSE', 'ASSET-LICENSE.md'
    ]) {
        assert.equal(includes(name), true, name);
    }
});

test('external runtime resource copies remain configured exactly once', () => {
    for (const name of ['bin', 'puppeteer']) {
        const copies = build.extraResources.filter(item => item.from === `resources/${name}`);
        assert.equal(copies.length, 1);
        assert.equal(copies[0].to, name);
        assert.deepEqual(copies[0].filter, ['**/*']);
    }
});
