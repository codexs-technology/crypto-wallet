// Flash USDT Wallet Frontend Application
// Supports: POL, TRON, ETH (ERC-20), BSC (BEP-20)
// Features: Flash Mint, Swap, Transfer, Trade with 7-day validity

class FlashWallet {
    constructor() {
        this.web3 = null;
        this.wallet = null;
        this.accounts = [];
        this.currentNetwork = 'POL';
        this.networks = {
            'POL': { name: 'Polygon', id: 'POL', chainId: 137, rpc: 'https://polygon-rpc.com', symbol: 'MATIC' },
            'TRC-20': { name: 'Tron', id: 'TRC-20', chainId: null, rpc: 'https://api.trongrid.org', symbol: 'TRX' },
            'ERC-20': { name: 'Ethereum', id: 'ERC-20', chainId: 1, rpc: 'https://1rpc.io/eth', symbol: 'ETH' },
            'BEP-20': { name: 'Binance', id: 'BEP-20', chainId: 56, rpc: 'https://bsc-dataseed.binance.org', symbol: 'BNB' }
        };
        this.mintedToken = null;
        this.apiBase = '/api';
        this.validityDays = 7;
        this.supportedPlatforms = ['Qurtex', 'Pocket Option', 'Exness', 'Stake', '7xBET', '1xBET'];
        this.supportedExchanges = ['Binance', 'Bitget', 'MEXC', 'Bybit'];
        this.supportedWallets = ['MetaMask', 'WalletConnect', 'Trust Wallet', 'Coinbase Wallet', 'Ledger', 'Trezor'];
        this.init();
    }

    init() {
        this.updateNetworkBadge();
        this.updateNetworkButtons();
        this.updateTimer();
        setInterval(() => this.updateTimer(), 1000);
        this.showToast('Flash USDT Wallet initialized', 'info');
    }

    // === WALLET CONNECTION ===

    async connectWallet() {
        try {
            if (typeof window.ethereum === 'undefined') {
                this.showToast('Please install MetaMask, Trust Wallet, or another Web3 wallet!', 'error');
                this.openWalletGuide();
                return;
            }

            this.web3 = new Web3(window.ethereum);

            // Request accounts
            const accounts = await this.web3.eth.requestAccounts();
            this.accounts = accounts;

            // Check network
            const chainId = await this.web3.eth.getChainId();
            await this.checkAndSwitchNetwork(chainId);

            // Get balance
            const balance = await this.web3.eth.getBalance(accounts[0]);
            const balanceEth = this.web3.utils.fromWei(balance, 'ether');

            this.wallet = {
                address: accounts[0],
                balance: balanceEth,
                chainId: chainId
            };

            this.renderWalletConnected();
            this.showToast('Wallet connected successfully!', 'success');

            // Listen for account changes
            window.ethereum.on('accountsChanged', (accounts) => {
                this.handleAccountsChanged(accounts);
            });

            // Listen for chain changes
            window.ethereum.on('chainChanged', () => {
                window.location.reload();
            });

        } catch (error) {
            console.error('Wallet connection error:', error);
            this.showToast(`Connection failed: ${error.message}`, 'error');
        }
    }

    async checkAndSwitchNetwork(chainId) {
        const networkMap = {
            1: 'ERC-20',
            137: 'POL',
            56: 'BEP-20',
        };

        const targetNetwork = networkMap[chainId];
        if (targetNetwork) {
            this.currentNetwork = targetNetwork;
            this.updateNetworkBadge();
            this.updateNetworkButtons();
        }
    }

    handleAccountsChanged(accounts) {
        if (accounts.length === 0) {
            this.wallet = null;
            this.showToast('Wallet disconnected', 'info');
            this.renderWalletDisconnected();
        } else {
            this.wallet = { ...this.wallet, address: accounts[0] };
            this.renderWalletConnected();
        }
    }

    renderWalletConnected() {
        const walletInfoDiv = document.getElementById('wallet-info');
        const networkSection = document.getElementById('network-section');
        const dashboardSection = document.getElementById('dashboard-section');
        const mintBtn = document.getElementById('wallet-connect-section');

        if (walletInfoDiv) {
            walletInfoDiv.innerHTML = `
                <div class="wallet-connected">
                    <div class="wallet-address">
                        <i class="fas fa-user-circle"></i>
                        <span id="wallet-address-display">${this.truncateAddress(this.wallet.address)}</span>
                        <button class="btn-copy" onclick="copyAddress()" title="Copy address">
                            <i class="far fa-copy"></i>
                        </button>
                    </div>
                    <div class="wallet-balance-info">
                        <span class="balance-value" id="wallet-balance">${this.wallet.balance}</span>
                        <span class="balance-symbol">${this.networks[this.currentNetwork].symbol}</span>
                    </div>
                </div>
            `;
        }

        if (networkSection) networkSection.style.display = 'block';
        if (dashboardSection) dashboardSection.style.display = 'block';
        if (mintBtn) mintBtn.style.display = 'none';

        // Load token balance
        this.loadTokenBalance();
    }

    renderWalletDisconnected() {
        const walletInfoDiv = document.getElementById('wallet-info');
        if (walletInfoDiv) {
            walletInfoDiv.innerHTML = `
                <button class="btn btn-primary btn-lg" onclick="connectWallet()">
                    <i class="fas fa-plug"></i> Connect Web3 Wallet
                </button>
            `;
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }

    // === NETWORK SWITCHING ===

    switchNetwork(networkId, networkName) {
        this.currentNetwork = networkId;
        this.updateNetworkBadge();
        this.updateNetworkButtons();
        this.showToast(`Switched to ${networkName}`, 'info');

        // Update token details
        const tokenNetwork = document.getElementById('token-network');
        if (tokenNetwork) {
            const network = this.networks[networkId];
            tokenNetwork.textContent = `${network.name} (${networkId})`;
        }

        // Reload balance for new network
        if (this.wallet) {
            this.loadTokenBalance();
        }
    }

    updateNetworkBadge() {
        const badge = document.getElementById('network-badge');
        if (badge && this.networks[this.currentNetwork]) {
            badge.textContent = this.networks[this.currentNetwork].id;
            badge.className = 'network-badge';
        }
    }

    updateNetworkButtons() {
        const buttons = document.querySelectorAll('.network-btn');
        buttons.forEach(btn => {
            if (btn.dataset.network === this.currentNetwork) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // === FLASH MINT ===

    async flashMint() {
        const amountInput = document.getElementById('flash-mint-amount');
        const amount = amountInput ? amountInput.value : '';

        if (!this.wallet) {
            this.showToast('Please connect your wallet first!', 'error');
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            this.showToast('Please enter a valid amount', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/flash-mint`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: this.wallet.address,
                    amount: parseFloat(amount),
                    network: this.currentNetwork,
                    walletType: 'web3'
                })
            });

            const result = await response.json();

            if (result.success) {
                this.mintedToken = result.data;
                this.showToast(`Flash USDT minted: ${result.data.amount} fUSDT`, 'success');
                this.loadTokenBalance();
                this.renderTokenDetails(result.data);
                this.startExpiryTimer(result.data.expiry);
            } else {
                this.showToast(`Mint failed: ${result.error}`, 'error');
            }

            if (amountInput) amountInput.value = '';
        } catch (error) {
            console.error('Flash mint error:', error);
            this.showToast('Network error during minting', 'error');
        }
    }

    renderTokenDetails(data) {
        const tokenDetails = document.getElementById('token-details');
        if (tokenDetails) {
            tokenDetails.innerHTML = `
                <h3><i class="fas fa-info-circle"></i> Flash USDT Details</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <label>Token</label>
                        <span>Flash USDT (fUSDT)</span>
                    </div>
                    <div class="detail-item">
                        <label>Network</label>
                        <span>${this.networks[this.currentNetwork].name} (${this.currentNetwork})</span>
                    </div>
                    <div class="detail-item">
                        <label>Minted</label>
                        <span>${data.amount} fUSDT</span>
                    </div>
                    <div class="detail-item">
                        <label>Mint ID</label>
                        <span class="mint-id">${data.mintId}</span>
                    </div>
                    <div class="detail-item">
                        <label>Status</label>
                        <span class="status-badge status-${data.status}">${data.status}</span>
                    </div>
                    <div class="detail-item">
                        <label>TX Hash</label>
                        <span class="tx-hash">${data.txHash || 'Simulated'}</span>
                    </div>
                </div>
            `;
        }
    }

    // === BALANCE LOADING ===

    async loadTokenBalance() {
        if (!this.wallet) return;

        const flashBalanceEl = document.getElementById('flash-balance');
        const validBalanceEl = document.getElementById('valid-balance-info');
        const balanceCheckEl = document.getElementById('balance-check');
        const transferFromEl = document.getElementById('transfer-from');
        const walletBalEl = document.getElementById('wallet-balance');

        try {
            const response = await fetch(
                `${this.apiBase}/wallet/${this.wallet.address}/balance?network=${this.currentNetwork}`
            );

            const result = await response.json();

            if (result.success) {
                if (flashBalanceEl) flashBalanceEl.textContent = result.data.flashUsdtBalance;
                if (validBalanceEl) {
                    validBalanceEl.innerHTML = `<span class="valid-amount">${result.data.validFlashUsdt}</span> valid`;
                }
                if (transferFromEl) transferFromEl.value = this.wallet.address;
                if (walletBalEl) {
                    walletBalEl.textContent = result.data.nativeBalance;
                    document.querySelector('.balance-symbol').textContent = result.data.nativeSymbol;
                }
            }
        } catch (error) {
            console.warn('Balance load error:', error);
        }
    }

    // === TRANSFER ===

    async executeTransfer() {
        const fromAddress = this.wallet?.address;
        const toAddress = document.getElementById('transfer-to')?.value;
        const amount = document.getElementById('transfer-amount')?.value;

        if (!fromAddress) {
            this.showToast('Please connect your wallet!', 'error');
            return;
        }
        if (!toAddress || !amount || parseFloat(amount) <= 0) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromAddress,
                    toAddress,
                    amount: parseFloat(amount),
                    network: this.currentNetwork,
                    mintId: this.mintedToken?.mintId
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showToast(`Transfer successful: ${result.data.amount} fUSDT to ${this.truncateAddress(toAddress)}`, 'success');
                this.loadTokenBalance();
            } else {
                this.showToast(`Transfer failed: ${result.error}`, 'error');
            }

            this.closeAllModals();
        } catch (error) {
            this.showToast('Network error during transfer', 'error');
        }
    }

    // === SWAP ===

    async executeSwap() {
        const fromToken = 'fUSDT';
        const toToken = document.getElementById('swap-to')?.value;
        const amount = document.getElementById('swap-amount')?.value;
        const slippage = document.getElementById('swap-slippage')?.value;

        if (!amount || parseFloat(amount) <= 0) {
            this.showToast('Please enter a valid amount', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromToken,
                    toToken,
                    amount: parseFloat(amount),
                    address: this.wallet?.address,
                    network: this.currentNetwork,
                    mintId: this.mintedToken?.mintId,
                    slippage: slippage || 1
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showToast(`Swap successful: ${amount} fUSDT -> ${toToken}`, 'success');
                this.loadTokenBalance();
            } else {
                this.showToast(`Swap failed: ${result.error}`, 'error');
            }

            this.closeAllModals();
        } catch (error) {
            this.showToast('Network error during swap', 'error');
        }
    }

    // === TRADE ===

    async executeTrade() {
        const fromToken = 'fUSDT';
        const toToken = document.getElementById('trade-to')?.value;
        const amount = document.getElementById('trade-amount')?.value;
        const side = document.getElementById('trade-side')?.value;
        const exchange = document.getElementById('trade-exchange')?.value;
        const price = document.getElementById('trade-price')?.value;

        if (!amount || parseFloat(amount) <= 0) {
            this.showToast('Please enter a valid amount', 'error');
            return;
        }
        if (!exchange) {
            this.showToast('Please select an exchange', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/trade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromToken,
                    toToken,
                    amount: parseFloat(amount),
                    address: this.wallet?.address,
                    network: this.currentNetwork,
                    side,
                    exchange,
                    price: price ? parseFloat(price) : 0,
                    mintId: this.mintedToken?.mintId
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showToast(`Trade executed on ${exchange}: ${amount} fUSDT -> ${toToken}`, 'success');
                this.loadTokenBalance();
            } else {
                this.showToast(`Trade failed: ${result.error}`, 'error');
            }

            this.closeAllModals();
        } catch (error) {
            this.showToast('Network error during trade', 'error');
        }
    }

    // === BURN EXPIRED ===

    async burnExpiredTokens() {
        if (!this.wallet) {
            this.showToast('Please connect your wallet first!', 'error');
            return;
        }

        if (!confirm('Are you sure you want to burn expired Flash USDT tokens?')) return;

        try {
            // This would be done via smart contract in production
            // For now, update the local token status
            const response = await fetch(
                `${this.apiBase}/wallet/${this.wallet.address}/tokens?network=${this.currentNetwork}`
            );
            const result = await response.json();

            if (result.success) {
                let burnedCount = 0;
                result.data.forEach(token => {
                    if (token.isExpired && token.status === 'active') {
                        token.status = 'expired';
                        // Remove from active list
                        burnedCount++;
                    }
                });
                this.showToast(`Burned ${burnedCount} expired token(s)`, 'success');
                this.loadTokenBalance();
            }
        } catch (error) {
            this.showToast('Error burning expired tokens', 'error');
        }
    }

    // === MODAL MANAGEMENT ===

    openSwapModal() {
        if (!this.wallet) {
            this.showToast('Please connect your wallet first!', 'error');
            return;
        }
        document.getElementById('swap-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    openTransferModal() {
        if (!this.wallet) {
            this.showToast('Please connect your wallet first!', 'error');
            return;
        }
        document.getElementById('transfer-modal').style.display = 'flex';
        document.getElementById('transfer-from').value = this.wallet.address;
        this.loadTokenBalance();
        document.body.style.overflow = 'hidden';
    }

    openTradeModal() {
        if (!this.wallet) {
            this.showToast('Please connect your wallet first!', 'error');
            return;
        }
        document.getElementById('trade-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.style.overflow = 'auto';
    }

    // === TIMER / VALIDITY ===

    startExpiryTimer(expiryISO) {
        const expiry = new Date(expiryISO).getTime();
        const timerEl = document.getElementById('timer-display');
        const footer = document.querySelector('.validity-timer');
        if (footer) footer.style.display = 'flex';
    }

    updateTimer() {
        if (this.mintedToken) {
            const expiry = new Date(this.mintedToken.expiry).getTime();
            const now = Date.now();
            const diff = expiry - now;

            const timerEl = document.getElementById('timer-display');
            if (timerEl) {
                if (diff <= 0) {
                    timerEl.textContent = 'EXPIRED';
                    timerEl.style.color = 'var(--danger-color)';
                } else {
                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                    timerEl.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
                }
            }
        }
    }

    // === UTILITY ===

    async copyAddress() {
        if (this.wallet) {
            await navigator.clipboard.writeText(this.wallet.address);
            this.showToast('Address copied to clipboard!', 'success');
        }
    }

    openWalletGuide() {
        const modal = document.getElementById('wallet-connect-section');
        if (modal) {
            modal.innerHTML = `
                <div class="connect-prompt">
                    <i class="fas fa-info-circle" style="color: var(--warning-color); font-size: 3rem;"></i>
                    <h3>Web3 Wallet Required</h3>
                    <p>Install one of these supported wallets to continue:</p>
                    <div class="wallet-list">
                        <div class="wallet-item"><i class="fab fa-google"></i> MetaMask</div>
                        <div class="wallet-item"><i class="fas fa-wallet"></i> WalletConnect</div>
                        <div class="wallet-item"><i class="fas fa-mobile-alt"></i> Trust Wallet</div>
                        <div class="wallet-item"><i class="fas fa-coin"></i> Coinbase Wallet</div>
                        <div class="wallet-item"><i class="fas fa-lock"></i> Ledger</div>
                        <div class="wallet-item"><i class="fas fa-key"></i> Trezor</div>
                    </div>
                    <button class="btn btn-secondary" onclick="location.reload()">Refresh</button>
                </div>
            `;
        }
    }

    showToast(message, type = 'info', duration = 5000) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.className = `toast toast-${type}`;
        toast.style.display = 'block';

        setTimeout(() => {
            toast.style.opacity = '1';
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 500);
            }, duration);
        }, 100);
    }
}

// === STANDALONE FUNCTIONS (for inline HTML onclick) ===

let walletApp;

document.addEventListener('DOMContentLoaded', () => {
    walletApp = new FlashWallet();
    window.connectWallet = () => walletApp.connectWallet();
    window.switchNetwork = (id, name) => walletApp.switchNetwork(id, name);
    window.flashMint = () => walletApp.flashMint();
    window.copyAddress = () => walletApp.copyAddress();
    window.closeModal = (id) => walletApp.closeModal(id);
    window.openSwapModal = () => walletApp.openSwapModal();
    window.openTransferModal = () => walletApp.openTransferModal();
    window.openTradeModal = () => walletApp.openTradeModal();
    window.executeSwap = () => walletApp.executeSwap();
    window.executeTransfer = () => walletApp.executeTransfer();
    window.executeTrade = () => walletApp.executeTrade();
    window.burnExpiredTokens = () => walletApp.burnExpiredTokens();
});
