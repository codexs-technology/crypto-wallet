const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashUSDT", function () {
    let FlashUSDT;
    let flashUSDT;
    let owner;
    let addr1;
    let addr2;

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();
        FlashUSDT = await ethers.getContractFactory("FlashUSDT");
        flashUSDT = await FlashUSDT.deploy();
        await flashUSDT.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the correct name and symbol", async function () {
            expect(await flashUSDT.name()).to.equal("Flash USDT");
            expect(await flashUSDT.symbol()).to.equal("fUSDT");
        });

        it("Should set the correct decimals", async function () {
            expect(await flashUSDT.decimals()).to.equal(6);
        });

        it("Should set the correct validity period (7 days)", async function () {
            const VALIDITY_PERIOD = await flashUSDT.VALIDITY_PERIOD();
            expect(VALIDITY_PERIOD).to.equal(7 * 24 * 60 * 60);
        });
    });

    describe("Flash Minting", function () {
        it("Should mint flash tokens with 7-day validity", async function () {
            const amount = ethers.parseUnits("100", 6);
            await flashUSDT.flashMint(addr1.address, amount);

        expect(await flashUSDT.balanceOf(addr1.address)).to.equal(amount);
        expect(await flashUSDT.validBalance(addr1.address)).to.equal(amount);
    });

        it("Should emit FlashMinted event", async function () {
            const amount = ethers.parseUnits("100", 6);
            const tx = await flashUSDT.flashMint(addr1.address, amount);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            await expect(tx)
                .to.emit(flashUSDT, "FlashMinted")
                .withArgs(addr1.address, amount, block.timestamp + 7 * 24 * 60 * 60);
        });

        it("Should reject minting to zero address", async function () {
            const amount = ethers.parseUnits("100", 6);
            await expect(flashUSDT.flashMint(ethers.ZeroAddress, amount)).to.be.revertedWith("Invalid address");
        });

        it("Should reject minting zero amount", async function () {
            await expect(flashUSDT.flashMint(addr1.address, 0)).to.be.revertedWith("Amount must be > 0");
        });
    });

    describe("Token Expiry", function () {
        it("Should track expiry correctly", async function () {
            const amount = ethers.parseUnits("100", 6);
            await flashUSDT.flashMint(addr1.address, amount);

            const [valid, total, nextExpiry] = await flashUSDT.getExpiryInfo(addr1.address);
            expect(valid).to.equal(amount);
            expect(total).to.equal(amount);
        });

        it("Should allow burning expired tokens", async function () {
            const amount = ethers.parseUnits("100", 6);
            await flashUSDT.flashMint(addr1.address, amount);

            // Advance time past validity period
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine", []);

            await flashUSDT.burnExpired(addr1.address);
            expect(await flashUSDT.balanceOf(addr1.address)).to.equal(0);
        });
    });

    describe("Transfer", function () {
        it("Should transfer valid tokens", async function () {
            const amount = ethers.parseUnits("50", 6);
            await flashUSDT.flashMint(addr1.address, amount);

            // Approve and transfer
            await flashUSDT.connect(addr1).transfer(addr2.address, amount);
            expect(await flashUSDT.balanceOf(addr2.address)).to.equal(amount);
        });

        it("Should reject transfer when transfers disabled", async function () {
            const amount = ethers.parseUnits("50", 6);
            await flashUSDT.flashMint(addr1.address, amount);
            await flashUSDT.setTransfersEnabled(false);

            await expect(flashUSDT.connect(addr1).transfer(addr2.address, amount)).to.be.revertedWith("Transfers are disabled");
            await flashUSDT.setTransfersEnabled(true);
        });
    });

    describe("Swap", function () {
        it("Should execute swap on valid tokens", async function () {
            const amount = ethers.parseUnits("50", 6);
            await flashUSDT.flashMint(addr1.address, amount);

            const tx = await flashUSDT.connect(addr1).swap(addr1.address, addr2.address, amount);
            await tx.wait();

            expect(await flashUSDT.balanceOf(addr1.address)).to.equal(0);
        });

        it("Should reject swap when disabled", async function () {
            await flashUSDT.setSwapsEnabled(false);
            await expect(flashUSDT.swap(addr1.address, addr2.address, 1)).to.be.revertedWith("Swaps are disabled");
            await flashUSDT.setSwapsEnabled(true);
        });
    });

    describe("Trade", function () {
        it("Should execute trade on valid tokens", async function () {
            const amount = ethers.parseUnits("50", 6);
            await flashUSDT.flashMint(addr1.address, amount);

            const tx = await flashUSDT.connect(addr1).trade(addr1.address, addr2.address, amount, true);
            await tx.wait();

            expect(await flashUSDT.balanceOf(addr1.address)).to.equal(0);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set flags", async function () {
            await flashUSDT.setSwapsEnabled(false);
            expect(await flashUSDT.swapsEnabled()).to.equal(false);
            await flashUSDT.setSwapsEnabled(true);
        });

        it("Should reject non-owner calls to admin functions", async function () {
            await expect(flashUSDT.connect(addr1).setSwapsEnabled(false))
                .to.be.revertedWithCustomError(flashUSDT, "OwnableUnauthorizedAccount")
                .withArgs(addr1.address);
        });
    });

    describe("Maximum Amount", function () {
        it("Should reject amounts exceeding max flash amount", async function () {
            const maxAmount = await flashUSDT.MAX_FLASH_AMOUNT();
            const overAmount = maxAmount + BigInt(1);
            await expect(flashUSDT.flashMint(addr1.address, overAmount)).to.be.revertedWith("Exceeds max flash amount");
        });
    });
});
