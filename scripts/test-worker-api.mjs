#!/usr/bin/env node
/**
 * API test for the Cloudflare Worker entry point (worker/index.js).
 *
 * It runs the Worker's fetch handler directly in Node with stubbed JSON-RPC and
 * static asset bindings, so every /api/* route can be verified without a
 * Cloudflare account or a network connection:
 *
 *   npm run test:api
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Load worker/index.js as an ES module (the repo package is CommonJS, so the
// source is copied to a temporary .mjs file first).
// ---------------------------------------------------------------------------
const workerSource = fs.readFileSync(path.join(root, 'worker', 'index.js'), 'utf8');
const tempModule = path.join(os.tmpdir(), `flash-worker-api-${process.pid}.mjs`);
fs.writeFileSync(tempModule, workerSource, 'utf8');
const { default: worker } = await import(pathToFileURL(tempModule).href);
fs.rmSync(tempModule, { force: true });

// ---------------------------------------------------------------------------
// Stubs: JSON-RPC responses + static assets binding
// ---------------------------------------------------------------------------
const rpcCalls = [];
const ONE_ETH = '0xde0b6b3a7640000'; // 1e18 wei
const FLASH_BALANCE = '0x1e8480'; // 2.000000 with 6 decimals
const VALID_BALANCE = '0xa0000'; // 0.655360 with 6 decimals

globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    rpcCalls.push({ url: String(url), method: body.method, data: body.params?.[0]?.data });
    if (body.method === 'eth_getBalance') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: ONE_ETH }), {
            headers: { 'content-type': 'application/json' },
        });
    }
    if (body.method === 'eth_call') {
        const data = body.params[0].data;
        const result = data.startsWith('0x70a08231') ? FLASH_BALANCE : VALID_BALANCE;
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
            headers: { 'content-type': 'application/json' },
        });
    }
    throw new Error(`Unexpected outbound fetch: ${url}`);
};

const env = {
    BACKEND_URL: '',
    FLASH_USDT_POLYGON: '0x1111111111111111111111111111111111111111',
    ASSETS: {
        fetch: async (request) => new Response(`ASSET:${new URL(request.url).pathname}`),
    },
};

const call = (pathname, init) =>
    worker.fetch(new Request(`https://wallet.test${pathname}`, init), env);

const post = (pathname, payload) =>
    call(pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });

// ---------------------------------------------------------------------------
// Tiny assertion helper
// ---------------------------------------------------------------------------
let failures = 0;
const results = [];
function check(name, condition, detail = '') {
    results.push(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail && !condition ? ` -> ${detail}` : ''}`);
    if (!condition) failures += 1;
}

const ADDRESS = '0xAbC0000000000000000000000000000000000123';
const json = (response) => response.json();

// ---------------------------------------------------------------------------
// Configuration endpoints
// ---------------------------------------------------------------------------
let response = await call('/api/health');
let body = await json(response);
check('GET /api/health -> 200 ok', response.status === 200 && body.status === 'ok' && Boolean(body.timestamp));

response = await call('/api/config');
body = await json(response);
check(
    'GET /api/config -> token metadata',
    body.data?.tokenName === 'Flash USDT' && body.data?.symbol === 'fUSDT' && body.data?.validityDays === 7,
    JSON.stringify(body).slice(0, 200)
);
check(
    'GET /api/config -> platforms/exchanges/networks',
    body.data?.platforms?.length === 6 && body.data?.exchanges?.length === 4 && body.data?.networks?.length === 4,
    JSON.stringify(body.data).slice(0, 200)
);

response = await call('/api/networks');
body = await json(response);
check('GET /api/networks -> 4 networks', Array.isArray(body.data) && body.data.length === 4, JSON.stringify(body).slice(0, 200));
check(
    'GET /api/networks -> RPC override applied',
    body.data.find((network) => network.key === 'POLYGON')?.rpc === 'https://polygon-rpc.com',
    JSON.stringify(body.data?.map((network) => network.rpc))
);

check('GET /api/platforms -> 6 platforms', (await json(await call('/api/platforms'))).data.length === 6);
check('GET /api/exchanges -> 4 exchanges', (await json(await call('/api/exchanges'))).data.length === 4);

// ---------------------------------------------------------------------------
// Flash mint -> token info -> token list
// ---------------------------------------------------------------------------
response = await post('/api/flash-mint', { address: ADDRESS, amount: 5000, network: 'POL', walletType: 'metamask' });
body = await json(response);
const mintId = body.data?.mintId;
check(
    'POST /api/flash-mint -> minted (simulated)',
    response.status === 200 && body.success === true && body.data?.network === 'Polygon' && body.data?.status === 'simulated',
    JSON.stringify(body).slice(0, 250)
);
check(
    'POST /api/flash-mint -> 7 day validity',
    body.data?.validityDays === 7 && !Number.isNaN(Date.parse(body.data?.expiry)),
    JSON.stringify(body.data).slice(0, 200)
);

response = await post('/api/flash-mint', { amount: 10, network: 'POL' });
check('POST /api/flash-mint -> address required', response.status === 400 && (await json(response)).error === 'Address required');
response = await post('/api/flash-mint', { address: ADDRESS, amount: 0, network: 'POL' });
check('POST /api/flash-mint -> valid amount required', response.status === 400 && (await json(response)).error === 'Valid amount required');
response = await post('/api/flash-mint', { address: ADDRESS, amount: 5, network: 'NOPE' });
check('POST /api/flash-mint -> invalid network', response.status === 400 && (await json(response)).error === 'Invalid network');

response = await call(`/api/token/${encodeURIComponent(mintId)}`);
body = await json(response);
check(
    'GET /api/token/:mintId -> record + not expired',
    response.status === 200 && body.data?.id === mintId && body.data?.isExpired === false,
    JSON.stringify(body).slice(0, 250)
);
check('GET /api/token/:mintId -> timeLeft days 6', body.data?.timeLeft?.days === 6, JSON.stringify(body.data?.timeLeft));

response = await call('/api/token/does-not-exist');
check('GET /api/token/:unknown -> 404', response.status === 404 && (await json(response)).error === 'Token not found');

response = await call(`/api/wallet/${ADDRESS}/tokens?network=POL`);
body = await json(response);
check(
    'GET /api/wallet/:address/tokens -> minted token',
    response.status === 200 && body.data?.length === 1 && body.data[0].id === mintId,
    JSON.stringify(body).slice(0, 250)
);

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------
response = await post('/api/transfer', { fromAddress: ADDRESS, toAddress: '0xdef', amount: 99999, network: 'POL', mintId });
check('POST /api/transfer -> insufficient balance', response.status === 400 && (await json(response)).error === 'Insufficient balance');
response = await post('/api/transfer', {
    fromAddress: ADDRESS,
    toAddress: '0xDef0000000000000000000000000000000000456',
    amount: 100,
    network: 'POL',
    mintId,
});
body = await json(response);
check(
    'POST /api/transfer -> success',
    response.status === 200 && body.message === 'Transfer successful' && body.data?.network === 'Polygon' && body.data?.amount === 100,
    JSON.stringify(body).slice(0, 250)
);
response = await post('/api/transfer', { fromAddress: ADDRESS, network: 'POL' });
check('POST /api/transfer -> missing fields', response.status === 400 && (await json(response)).error === 'Missing required fields');

// ---------------------------------------------------------------------------
// Swap + trade
// ---------------------------------------------------------------------------
response = await post('/api/swap', { fromToken: 'fUSDT', network: 'POL' });
check('POST /api/swap -> missing fields', response.status === 400 && (await json(response)).error === 'Missing required fields');
response = await post('/api/swap', { fromToken: 'fUSDT', toToken: 'USDT', amount: 10, address: ADDRESS, network: 'ERC-20', mintId });
body = await json(response);
check(
    'POST /api/swap -> processed',
    response.status === 200 && body.message === 'Swap processed' && body.data?.network === 'Ethereum' && body.data?.estimatedOutput === null,
    JSON.stringify(body).slice(0, 250)
);

response = await post('/api/trade', { fromToken: 'fUSDT', toToken: 'USDT', amount: 5, exchange: 'Kraken', network: 'POL' });
check('POST /api/trade -> unsupported exchange', response.status === 400 && (await json(response)).error === 'Exchange Kraken not supported');
response = await post('/api/trade', {
    fromToken: 'fUSDT',
    toToken: 'USDT',
    amount: 5,
    address: ADDRESS,
    exchange: 'Binance',
    side: 'sell',
    price: 1.01,
    network: 'BEP-20',
    mintId,
});
body = await json(response);
check(
    'POST /api/trade -> filled',
    response.status === 200 &&
        body.data?.status === 'filled' &&
        body.data?.side === 'sell' &&
        body.data?.network === 'Binance Smart Chain',
    JSON.stringify(body).slice(0, 250)
);

// ---------------------------------------------------------------------------
// Wallet balance (JSON-RPC stubbed above)
// ---------------------------------------------------------------------------
rpcCalls.length = 0;
response = await call(`/api/wallet/${ADDRESS}/balance?network=POL`);
body = await json(response);
check('GET /api/wallet/:address/balance -> native 1', body.data?.nativeBalance === '1', JSON.stringify(body).slice(0, 250));
check('GET /api/wallet/:address/balance -> flash 2', body.data?.flashUsdtBalance === '2', JSON.stringify(body).slice(0, 200));
check('GET /api/wallet/:address/balance -> valid 0.65536', body.data?.validFlashUsdt === '0.65536');
check('GET /api/wallet/:address/balance -> native symbol MATIC', body.data?.nativeSymbol === 'MATIC');
check('GET /api/wallet/:address/balance -> eth_getBalance called', rpcCalls.some((c) => c.method === 'eth_getBalance'));
check(
    'GET /api/wallet/:address/balance -> token selectors',
    rpcCalls.some((c) => c.data?.startsWith('0x70a08231')) && rpcCalls.some((c) => c.data?.startsWith('0x3e9c8055')),
    JSON.stringify(rpcCalls.map((c) => c.data))
);
response = await call(`/api/wallet/${ADDRESS}/balance?network=NOPE`);
check('GET /api/wallet/:address/balance -> invalid network', response.status === 400 && (await json(response)).error === 'Invalid network');

// ---------------------------------------------------------------------------
// Routing, static assets and the BACKEND_URL proxy switch
// ---------------------------------------------------------------------------
response = await call('/api/not-a-route');
check('GET /api/unknown -> 404', response.status === 404 && (await json(response)).error === 'Endpoint not found');
check('GET /api/unknown -> CORS header', response.headers.get('access-control-allow-origin') === '*');
check('OPTIONS /api/* -> 204 preflight', (await call('/api/health', { method: 'OPTIONS' })).status === 204);

check('GET / -> served from the ASSETS binding', (await (await call('/')).text()) === 'ASSET:/');
check('GET /app.js -> served from the ASSETS binding', (await (await call('/app.js')).text()) === 'ASSET:/app.js');

const proxied = [];
globalThis.fetch = async (url, init = {}) => {
    proxied.push({
        url: url instanceof Request ? url.url : String(url),
        method: url instanceof Request ? url.method : init.method,
    });
    return new Response('proxied');
};
response = await worker.fetch(new Request('https://wallet.test/api/health'), { ...env, BACKEND_URL: 'https://backend.example.com/' });
check(
    'BACKEND_URL set -> /api/* proxied',
    (await response.text()) === 'proxied' && proxied[0]?.url === 'https://backend.example.com/api/health',
    JSON.stringify(proxied)
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
