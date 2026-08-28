const { expect } = require("chai");

describe("EscrowBridge", function () {
  let bridge;
  let token;
  let owner;
  let relayer;
  let depositor;
  let recipient;

  beforeEach(async function () {
    [owner, relayer, depositor, recipient] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock Token", "MTK", 18);
    await token.waitForDeployment();

    const EscrowBridge = await ethers.getContractFactory("EscrowBridge");
    bridge = await EscrowBridge.deploy(await token.getAddress(), ethers.keccak256(ethers.toUtf8Bytes("stellar-testnet")));
    await bridge.waitForDeployment();

    await bridge.addRelayer(relayer.address);
    await token.mint(depositor.address, ethers.parseEther("100"));
    await token.connect(depositor).approve(await bridge.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await bridge.owner()).to.equal(owner.address);
    });

    it("Should accept token deposits", async function () {
      const amount = ethers.parseEther("10");
      await token.connect(depositor).approve(await bridge.getAddress(), amount);
      await token.connect(depositor).transfer(await bridge.getAddress(), amount);
      expect(await token.balanceOf(await bridge.getAddress())).to.equal(amount);
    });
  });
});
