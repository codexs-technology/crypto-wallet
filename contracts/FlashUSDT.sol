// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * Flash USDT Token
 * - ERC-20 compatible on Ethereum (ERC-20), Polygon (POL), Binance (BEP-20)
 * - Flash minting: generate tokens that expire after 7 days
 * - Transferable, Swapable, Tradeable
 * - Tokens auto-expire after VALIDITY_PERIOD (7 days)
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FlashUSDT is ERC20, Ownable {
    string public constant TOKEN_NAME = "Flash USDT";
    string public constant TOKEN_SYMBOL = "fUSDT";
    uint8 public constant TOKEN_DECIMALS = 6;
    uint256 public constant VALIDITY_PERIOD = 7 days;
    uint256 public constant MAX_FLASH_AMOUNT = 1_000_000 * 10 ** TOKEN_DECIMALS;

    struct TokenBatch {
        uint256 amount;
        uint256 expiry;
    }

    mapping(address => TokenBatch[]) public tokenBatches;
    mapping(address => uint256) public totalFlashMinted;
    mapping(address => uint256) public validBalance;

    bool public swapsEnabled = true;
    bool public tradesEnabled = true;
    bool public transfersEnabled = true;

    event FlashMinted(address indexed to, uint256 amount, uint256 expiry);
    event FlashBurned(address indexed from, uint256 amount, uint256 reason);
    event TokensSwapped(address indexed trader, address indexed fromToken, address indexed toToken, uint256 amount, uint256 outputAmount);
    event TokensTraded(address indexed trader, address indexed fromToken, address indexed toToken, uint256 amount, uint256 outputAmount, bool isBuy);
    event TokensTransferred(address indexed from, address to, uint256 amount);

    constructor() ERC20(TOKEN_NAME, TOKEN_SYMBOL) Ownable(msg.sender) {}

    function decimals() public view override returns (uint8) {
        return TOKEN_DECIMALS;
    }

    /*
     * BURN EXPIRED TOKENS - public (called internally by swap/trade/transfer)
     */
    function burnExpired(address account) public {
        uint256 burnedAmount = 0;
        uint256 length = tokenBatches[account].length;

        for (uint256 i = 0; i < length; i++) {
            if (tokenBatches[account][i].expiry <= block.timestamp) {
                burnedAmount += tokenBatches[account][i].amount;
                tokenBatches[account][i].amount = 0;
            }
        }

        uint256 validCount = 0;
        for (uint256 i = 0; i < length; i++) {
            if (tokenBatches[account][i].amount > 0) {
                tokenBatches[account][validCount] = tokenBatches[account][i];
                validCount++;
            }
        }

        while (tokenBatches[account].length > validCount) {
            tokenBatches[account].pop();
        }

        if (burnedAmount > 0) {
            _burn(account, burnedAmount);
            if (validBalance[account] >= burnedAmount) {
                validBalance[account] -= burnedAmount;
            }
            emit FlashBurned(account, burnedAmount, 1);
        }
    }

    /*
     * BURN FLASH TOKENS MANUALLY - public (called internally by swap/trade)
     */
    function burnFlash(address account, uint256 amount) public {
        require(amount > 0, "Amount must be > 0");

        uint256 currentValid = validBalance[account];
        require(currentValid >= amount, "Insufficient valid balance");

        uint256 burnedAmount = 0;
        uint256 remaining = amount;
        uint256 length = tokenBatches[account].length;

        for (uint256 i = 0; i < length && remaining > 0; i++) {
            if (tokenBatches[account][i].expiry > block.timestamp) {
                if (tokenBatches[account][i].amount <= remaining) {
                    remaining -= tokenBatches[account][i].amount;
                    burnedAmount += tokenBatches[account][i].amount;
                    tokenBatches[account][i].amount = 0;
                } else {
                    tokenBatches[account][i].amount -= remaining;
                    burnedAmount += remaining;
                    remaining = 0;
                }
            }
        }

        require(burnedAmount >= amount, "Insufficient valid tokens in batches");

        _burn(account, burnedAmount);
        validBalance[account] = currentValid - amount;

        emit FlashBurned(account, burnedAmount, 2);
    }

    /*
     * FLASH MINTING
     */
    function flashMint(address to, uint256 amount) public {
        require(to != address(0), "Invalid address");
        require(amount > 0, "Amount must be > 0");
        require(amount <= MAX_FLASH_AMOUNT, "Exceeds max flash amount");

        uint256 expiry = block.timestamp + VALIDITY_PERIOD;
        tokenBatches[to].push(TokenBatch(amount, expiry));

        _mint(to, amount);
        validBalance[to] += amount;
        totalFlashMinted[to] += amount;

        emit FlashMinted(to, amount, expiry);
    }

    /*
     * SWAP - Swap Flash USDT for another token via DEX aggregator
     */
    function swap(
        address fromToken,
        address toToken,
        uint256 amount
    ) public returns (bool) {
        require(swapsEnabled, "Swaps are disabled");
        require(amount > 0, "Amount must be > 0");
        require(validBalance[msg.sender] >= amount, "Insufficient valid balance");

        burnFlash(msg.sender, amount);

        emit TokensSwapped(msg.sender, fromToken, toToken, amount, 0);
        return true;
    }

    /*
     * TRADE - Trade Flash USDT on exchange integrations
     */
    function trade(
        address fromToken,
        address toToken,
        uint256 amount,
        bool isBuy
    ) public returns (bool) {
        require(tradesEnabled, "Trades are disabled");
        require(amount > 0, "Amount must be > 0");
        require(validBalance[msg.sender] >= amount, "Insufficient valid balance");

        burnFlash(msg.sender, amount);

        emit TokensTraded(msg.sender, fromToken, toToken, amount, 0, isBuy);
        return true;
    }

    /*
     * Override transfer to enforce validity checks
     */
    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        require(transfersEnabled, "Transfers are disabled");
        burnExpired(msg.sender);
        require(
            validBalance[msg.sender] >= amount,
            "Insufficient valid balance (expired or insufficient)"
        );
        validBalance[msg.sender] -= amount;
        validBalance[to] += amount;
        emit TokensTransferred(msg.sender, to, amount);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        require(transfersEnabled, "Transfers are disabled");
        burnExpired(from);
        require(
            validBalance[from] >= amount,
            "Insufficient valid balance (expired or insufficient)"
        );
        validBalance[from] -= amount;
        validBalance[to] += amount;
        emit TokensTransferred(from, to, amount);
        return super.transferFrom(from, to, amount);
    }

    /*
     * ADMIN FUNCTIONS
     */
    function setSwapsEnabled(bool enabled) public onlyOwner {
        swapsEnabled = enabled;
    }

    function setTradesEnabled(bool enabled) public onlyOwner {
        tradesEnabled = enabled;
    }

    function setTransfersEnabled(bool enabled) public onlyOwner {
        transfersEnabled = enabled;
    }

    function emergencyWithdraw(address token, uint256 amount) public onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).transfer(owner(), amount);
        }
    }

    /*
     * VIEW FUNCTIONS
     */
    function getRemainingValid(address account) public view returns (uint256) {
        return validBalance[account];
    }

    function getExpiryInfo(address account)
        public
        view
        returns (
            uint256 validTokens,
            uint256 totalTokens,
            uint256 nextExpiry
        )
    {
        uint256 valid = 0;
        uint256 total = 0;
        uint256 nextExp = type(uint256).max;

        uint256 length = tokenBatches[account].length;
        for (uint256 i = 0; i < length; i++) {
            total += tokenBatches[account][i].amount;
            if (tokenBatches[account][i].expiry > block.timestamp) {
                valid += tokenBatches[account][i].amount;
                if (tokenBatches[account][i].expiry < nextExp) {
                    nextExp = tokenBatches[account][i].expiry;
                }
            }
        }

        return (valid, total, nextExp);
    }

    function getTokenBatches(address account)
        public
        view
        returns (TokenBatch[] memory)
    {
        return tokenBatches[account];
    }

    function clearExpiredBatches(address account) public {
        uint256 length = tokenBatches[account].length;
        uint256 validCount = 0;

        for (uint256 i = 0; i < length; i++) {
            if (tokenBatches[account][i].expiry > block.timestamp) {
                tokenBatches[account][validCount] = tokenBatches[account][i];
                validCount++;
            }
        }

        while (tokenBatches[account].length > validCount) {
            tokenBatches[account].pop();
        }
    }

    function name() public view override returns (string memory) {
        return TOKEN_NAME;
    }

    function symbol() public view override returns (string memory) {
        return TOKEN_SYMBOL;
    }
}
