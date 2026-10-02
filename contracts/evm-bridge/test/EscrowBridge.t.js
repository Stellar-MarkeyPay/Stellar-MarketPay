const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowBridge", function () {
  let bridge;
  let token;
  let owner;
  let relayer;
  let depositor;
  let recipient;
  const CHAIN_ID = ethers.keccak256(ethers.toUtf8Bytes("stellar-testnet"));
  const RECOVERY_DELAY = 7 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, relayer, depositor, recipient] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock Token", "MTK", 18);
    await token.waitForDeployment();

    const EscrowBridge = await ethers.getContractFactory("EscrowBridge");
    bridge = await EscrowBridge.deploy(await token.getAddress(), CHAIN_ID);
    await bridge.waitForDeployment();

    await bridge.addRelayer(relayer.address);

    await token.mint(depositor.address, ethers.parseEther("100"));
    await token.connect(depositor).approve(await bridge.getAddress(), ethers.MaxUint256);
  });

  describe("Deposits", function () {
    it("should create a deposit with correct state", async function () {
      const amount = ethers.parseEther("1");
      const nonce = 1;
      const sorobanTxHash = ethers.keccak256(ethers.toUtf8Bytes("soroban-tx-1"));

      await expect(
        bridge.connect(depositor).deposit(recipient.address, sorobanTxHash, CHAIN_ID, nonce)
      ).to.emit(bridge, "Deposited");

      const transfer = await bridge.transfers(
        ethers.keccak256(ethers.encodeBytes32String(depositor.address + recipient.address + nonce))
      );
      expect(transfer.depositor).to.equal(depositor.address);
      expect(transfer.recipient).to.equal(recipient.address);
      expect(transfer.amount).to.equal(amount);
    });

    it("should reject replay attacks", async function () {
      const nonce = 1;
      const sorobanTxHash = ethers.keccak256(ethers.toUtf8Bytes("soroban-tx-1"));

      await bridge.connect(depositor).deposit(recipient.address, sorobanTxHash, CHAIN_ID, nonce);
      await expect(
        bridge.connect(depositor).deposit(recipient.address, sorobanTxHash, CHAIN_ID, nonce)
      ).to.be.revertedWith("Replay detected");
    });

    it("should reject wrong chain ID", async function () {
      const wrongChainId = ethers.keccak256(ethers.toUtf8Bytes("wrong-chain"));
      const nonce = 2;
      const sorobanTxHash = ethers.keccak256(ethers.toUtf8Bytes("soroban-tx-2"));

      await expect(
        bridge.connect(depositor).deposit(recipient.address, sorobanTxHash, wrongChainId, nonce)
      ).to.be.revertedWith("Invalid chain ID");
    });
  });

  describe("Releases", function () {
    let transferId;
    let sorobanTxHash;

    beforeEach(async function () {
      const amount = ethers.parseEther("1");
      sorobanTxHash = ethers.keccak256(ethers.toUtf8Bytes("soroban-tx-3"));
      const nonce = 3;

      const tx = await bridge.connect(depositor).deposit(recipient.address, sorobanTxHash, CHAIN_ID, nonce);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "Deposited"
      );
      transferId = event.args.id;
    });

    it("should release funds with valid proof", async function () {
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(["bytes32", "bytes32", "uint256"], [transferId, sorobanTxHash, block.chainid])
      );
      const signature = await relayer.signMessage(ethers.getBytes(messageHash));

      await expect(bridge.release(transferId, sorobanTxHash, signature))
        .to.emit(bridge, "Released");

      const balance = await token.balanceOf(recipient.address);
      expect(balance).to.equal(ethers.parseEther("1"));
    });

    it("should reject unauthorized relayer", async function () {
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(["bytes32", "bytes32", "uint256"], [transferId, sorobanTxHash, block.chainid])
      );
      const signature = await depositor.signMessage(ethers.getBytes(messageHash));

      await expect(bridge.release(transferId, sorobanTxHash, signature))
        .to.be.revertedWith("Unauthorized relayer");
    });
  });

  describe("Circuit Breaker", function () {
    it("should pause when triggered", async function () {
      await bridge.triggerCircuitBreaker("test");
      expect(await bridge.bridgeHalted()).to.be.true;
    });

    it("should resume after pause", async function () {
      await bridge.triggerCircuitBreaker("test");
      await bridge.unpause();
      expect(await bridge.bridgeHalted()).to.be.false;
    });
  });

  describe("Emergency Recovery", function () {
    it("should allow refund after recovery deadline", async function () {
      const amount = ethers.parseEther("1");
      const nonce = 4;
      const sorobanTxHash = ethers.keccak256(ethers.toUtf8Bytes("soroban-tx-4"));

      const tx = await bridge.connect(depositor).deposit(recipient.address, sorobanTxHash, CHAIN_ID, nonce);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "Deposited"
      );
      const transferId = event.args.id;

      await ethers.provider.send("evm_increaseTime", [RECOVERY_DELAY + 1]);
      await ethers.provider.send("evm_mine");

      await expect(bridge.emergencyRefund(transferId))
        .to.emit(bridge, "Refunded");

      const balance = await token.balanceOf(depositor.address);
      expect(balance).to.equal(amount);
    });
  });
});
