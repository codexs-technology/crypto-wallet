const fs = require('fs');
const path = require('path');

// Load ABI from deployments
const abiPath = path.join(__dirname, '../deployments/flashusdt-abi.json');
let FlashUSDT_ABI = null;

try {
    const abiData = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    FlashUSDT_ABI = abiData.abi || abiData;
} catch (e) {
    console.error('Warning: Could not load Flash USDT ABI, using minimal ABI');
    FlashUSDT_ABI = [
        "function flashMint(address to, uint256 amount) external",
        "function burnExpired(address account) external",
        "function burnFlash(address account, uint256 amount) external",
        "function transfer(address to, uint256 amount) external returns (bool)",
        "function balanceOf(address owner) external view returns (uint256)",
        "function totalValid(address account) external view returns (uint256)",
        "function getRemainingValid(address account) external view returns (uint256)",
        "uint256: totalFlashMinted",
    ];
}

// ERC-20 standard ABI for USDT interactions
const ERC20_ABI = [
    "function name() view returns (string memory)",
    "function symbol() view returns (string memory)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
];

module.exports = {
    FlashUSDT_ABI,
    ERC20_ABI,
};
