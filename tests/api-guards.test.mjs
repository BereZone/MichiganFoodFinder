// Guards on the public API surface. These all short-circuit before any Supabase
// call, so the fake credentials below are never used to reach the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.INGEST_TOKEN = 'correct-horse-battery-staple';

const require = createRequire(import.meta.url);

// Stub the Supabase client before the handlers construct theirs, so the
// warm-cache test can count how many reads a burst of requests really costs.
let selectCalls = 0;
const stub = {
    from() {
        const chain = {
            select() { selectCalls += 1; return chain; },
            gte() { return chain; },
            lte() { return chain; },
            order() { return chain; },
            range() { return Promise.resolve({ data: [], error: null }); },
        };
        return chain;
    },
};
require.cache[require.resolve('@supabase/supabase-js')] = {
    id: 'supabase-stub', filename: 'supabase-stub', loaded: true,
    exports: { createClient: () => stub },
};

const menus = require('../api/menus.js');
const ingest = require('../api/ingest.js');

// Minimal stand-in for the Vercel/Express response object.
function mockRes() {
    const res = {
        statusCode: null,
        headers: {},
        body: undefined,
        ended: false,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.ended = true; return this; },
        end() { this.ended = true; return this; },
    };
    return res;
}

test('menus: rejects non-read methods instead of bypassing the CDN', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const res = mockRes();
        await menus({ method, url: '/api/menus', headers: {} }, res);
        assert.equal(res.statusCode, 405, `${method} should be refused`);
        assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
    }
});

test('menus: redirects cache-busting query strings to the canonical URL', async () => {
    const res = mockRes();
    await menus({ method: 'GET', url: '/api/menus?cb=12345', headers: {} }, res);
    assert.equal(res.statusCode, 308);
    assert.equal(res.headers.location, '/api/menus');
    assert.match(res.headers['cache-control'], /s-maxage/);
});

test('menus: preflight succeeds and advertises only read methods', async () => {
    const res = mockRes();
    await menus({ method: 'OPTIONS', url: '/api/menus', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['access-control-allow-methods'], 'GET, HEAD, OPTIONS');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
});

test('ingest: refuses a missing, wrong, or truncated token', async () => {
    for (const token of [undefined, '', 'wrong', 'correct-horse-battery-stapl']) {
        const res = mockRes();
        const headers = token === undefined ? {} : { 'x-ingest-token': token };
        await ingest({ method: 'POST', url: '/api/ingest', headers, body: { rows: [] } }, res);
        assert.equal(res.statusCode, 401, `token ${JSON.stringify(token)} should be refused`);
    }
});

test('ingest: refuses an oversized body before parsing it', async () => {
    const res = mockRes();
    await ingest({
        method: 'POST',
        url: '/api/ingest',
        headers: { 'content-length': String(64 * 1024 * 1024), 'x-ingest-token': 'correct-horse-battery-staple' },
        body: { rows: [] },
    }, res);
    assert.equal(res.statusCode, 413);
});

test('ingest: rejects non-POST', async () => {
    const res = mockRes();
    await ingest({ method: 'GET', url: '/api/ingest', headers: {} }, res);
    assert.equal(res.statusCode, 405);
});

test('ingest: a valid token still refuses an empty payload', async () => {
    const res = mockRes();
    await ingest({
        method: 'POST',
        url: '/api/ingest',
        headers: { 'x-ingest-token': 'correct-horse-battery-staple' },
        body: { rows: [] },
    }, res);
    assert.equal(res.statusCode, 400);
});

test('menus: a burst of requests collapses into a single database read', async () => {
    selectCalls = 0;

    // 50 concurrent requests, as a load test would send them.
    await Promise.all(Array.from({ length: 50 }, () => {
        const res = mockRes();
        return menus({ method: 'GET', url: '/api/menus', headers: {} }, res)
            .then(() => assert.equal(res.statusCode, 200));
    }));
    assert.equal(selectCalls, 1, 'concurrent misses should share one in-flight read');

    // And a later serial request inside the TTL reuses the memoized payload.
    const res = mockRes();
    await menus({ method: 'GET', url: '/api/menus', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(selectCalls, 1, 'a warm instance should not re-query within the TTL');
});

test('menus: HEAD is served from cache headers without a body', async () => {
    const res = mockRes();
    await menus({ method: 'HEAD', url: '/api/menus', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, undefined);
    assert.match(res.headers['cache-control'], /s-maxage=3600/);
});
