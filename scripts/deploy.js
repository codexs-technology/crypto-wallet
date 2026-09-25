const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying Flash USDT with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const FlashUSDT = await hre.ethers.getContractFactory("FlashUSDT");
    const flashUSDT = await FlashUSDT.deploy();
    await flashUSDT.deployed();

    console.log("Flash USDT deployed to:", flashUSDT.address);

    // Network-specific addresses (would be on different chains in production)
    const network = hre.network.name;
    console.log("Deployed on network:", network);

    // Save deployment info
    const fs = require("fs");
    const deployInfo = {
        address: flashUSDT.address,
        network: network,
        deployer: deployer.address,
        abi: JSON.parse(flashUSDT.interface.format("json"))
    };

    fs.writeFileSync(
        `deployments/flashusdt-${network}.json`,
        JSON.stringify(deployInfo, null, 2)
    );
    console.log("Deployment info saved to deployments/flashusdt-" + network + ".json");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
