import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// The Electron source mixes CommonJS dependencies with ESM exports. Inject
// createRequire when loading it in Node, without rewriting the code under test.
const sourceUrl = new URL('../src/main/utils.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const prelude = `import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(sourceUrl.href)});\n`;
const { generateXrayConfig, parseProxyLink } = await import(
    `data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`
);

const uuid = '11111111-1111-4111-8111-111111111111';
const preProxy = {
    preProxies: [{ url: `vless://${uuid}@192.0.2.1:443?security=tls&sni=example.com&type=tcp` }]
};
const fingerprint = { browserType: 'chrome', browserMajorVersion: 134 };
const fixtures = {
    socks: 'socks5://user:pass@192.0.2.2:1080',
    http: 'http://user:pass@192.0.2.2:8080',
    vlessTls: `vless://${uuid}@192.0.2.2:443?security=tls&sni=example.com&type=ws&path=%2Fproxy&host=example.com`,
    vlessReality: `vless://${uuid}@192.0.2.2:443?security=reality&sni=example.com&type=tcp&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123456789abcdef`
};

for (const [name, link] of Object.entries(fixtures)) {
    test(`${name}: pre-proxy uses dialerProxy and preserves main outbound settings`, () => {
        const direct = generateXrayConfig(link, 10808, null, fingerprint);
        const chained = generateXrayConfig(link, 10808, preProxy, fingerprint);
        const main = chained.outbounds.find(o => o.tag === 'proxy_main');
        const original = direct.outbounds.find(o => o.tag === 'proxy_main');
        assert.deepEqual(chained.outbounds.map(o => o.tag), ['proxy_pre', 'proxy_main', 'direct']);
        assert.equal(main.streamSettings.sockopt.dialerProxy, 'proxy_pre');
        assert.deepEqual(main.settings, original.settings);
        assert.deepEqual(main.streamSettings, {
            ...original.streamSettings,
            sockopt: { ...original.streamSettings?.sockopt, dialerProxy: 'proxy_pre' }
        });
        assert.equal(JSON.stringify(chained).includes('"proxySettings"'), false);
        assert.equal(chained.outbounds[0].streamSettings.sockopt?.dialerProxy, undefined);
        assert.deepEqual(chained.routing, direct.routing);
        assert.deepEqual(chained.inbounds, direct.inbounds);
    });
}

for (const pre of [null, {}, { preProxies: [] }]) {
    test(`disabled/empty pre-proxy stays unchanged: ${JSON.stringify(pre)}`, () => {
        const config = generateXrayConfig(fixtures.socks, 10808, pre);
        assert.deepEqual(config.outbounds, [
            parseProxyLink(fixtures.socks, 'proxy_main'),
            { protocol: 'freedom', tag: 'direct' }
        ]);
    });
}

test('pre-proxy TLS fingerprint is preserved', () => {
    const config = generateXrayConfig(fixtures.socks, 10808, preProxy, fingerprint);
    assert.equal(config.outbounds[0].streamSettings.tlsSettings.fingerprint, 'chrome');
});

test('generated configs pass the selected Xray core configuration check', {
    skip: !process.env.XRAY_BINARY && 'Set XRAY_BINARY to enable native core validation'
}, () => {
    for (const link of Object.values(fixtures)) {
        for (const pre of [null, preProxy]) {
            const config = generateXrayConfig(link, 10808, pre, fingerprint);
            const result = spawnSync(process.env.XRAY_BINARY,
                ['run', '-test', '-format', 'json', '-config', 'stdin:'], {
                    input: JSON.stringify(config), encoding: 'utf8', timeout: 20000,
                    windowsHide: true
                });
            assert.ifError(result.error);
            assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
            assert.match(result.stdout + result.stderr, /Configuration OK/);
        }
    }
});
