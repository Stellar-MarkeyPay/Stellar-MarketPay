// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EscrowBridge is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct BridgeTransfer {
        bytes32 id;
        address depositor;
        address recipient;
        bytes32 sorobanTxHash;
        uint64 sourceBlockNumber;
        uint32 sourceLogIndex;
        uint256 amount;
        address token;
        Status status;
        uint32 confirmations;
        uint32 requiredConfirmations;
        uint64 nonce;
        bytes32 chainId;
        uint256 createdAt;
        uint256 recoveryDeadline;
    }

    enum Status {
        Pending,
        Deposited,
        Released,
        Refunded,
        Recovering
    }

    bytes32 public constant CHAIN_ID;
    uint32 public constant REQUIRED_CONFIRMATIONS;
    uint256 public constant RECOVERY_DELAY = 7 days;
    uint256 public constant MAX_HOURLY_VOLUME = 100 ether;
    uint256 public constant MAX_FAILURE_RATE_BPS = 500;

    IERC20 public immutable token;

    mapping(bytes32 => BridgeTransfer) public transfers;
    mapping(uint64 => bool) public usedNonces;
    mapping(address => bool) public authorizedRelayers;

    uint256 public hourlyVolumeStart;
    uint256 public hourlyVolume;
    uint256 public totalVerifications;
    uint256 public failedVerifications;
    bool public bridgeHalted;

    event Deposited(
        bytes32 indexed id,
        address indexed depositor,
        address indexed recipient,
        uint256 amount,
        bytes32 sorobanTxHash
    );
    event Released(bytes32 indexed id, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed id, address indexed depositor, uint256 amount);
    event RecoveryInitiated(bytes32 indexed id, uint256 deadline);
    event Recovered(bytes32 indexed id, address indexed depositor, uint256 amount);
    event CircuitBreakerTriggered(string reason);
    event CircuitBreakerReset();
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);

    modifier whenBridgeActive() {
        require(!bridgeHalted, "Bridge halted");
        _;
    }

    modifier validRecoveryDeadline(uint256 deadline) {
        require(deadline >= block.timestamp + RECOVERY_DELAY, "Invalid deadline");
        _;
    }

    constructor(address _token, bytes32 _chainId) Ownable(msg.sender) {
        token = IERC20(_token);
        CHAIN_ID = _chainId;
        REQUIRED_CONFIRMATIONS = 12;
        hourlyVolumeStart = block.timestamp;
    }

    function deposit(
        address recipient,
        bytes32 sorobanTxHash,
        bytes32 chainId,
        uint64 nonce
    ) external whenBridgeActive nonReentrant returns (bytes32 transferId) {
        require(!usedNonces[nonce], "Replay detected");
        require(chainId == CHAIN_ID, "Invalid chain ID");

        usedNonces[nonce] = true;

        uint256 amount = token.balanceOf(msg.sender);
        require(amount > 0, "Insufficient balance");

        transferId = keccak256(
            abi.encodePacked(msg.sender, recipient, amount, nonce, block.timestamp)
        );

        token.safeTransferFrom(msg.sender, address(this), amount);

        transfers[transferId] = BridgeTransfer({
            id: transferId,
            depositor: msg.sender,
            recipient: recipient,
            sorobanTxHash: sorobanTxHash,
            sourceBlockNumber: uint64(block.number),
            sourceLogIndex: 0,
            amount: amount,
            token: address(token),
            status: Status.Deposited,
            confirmations: 0,
            requiredConfirmations: REQUIRED_CONFIRMATIONS,
            nonce: nonce,
            chainId: chainId,
            createdAt: block.timestamp,
            recoveryDeadline: block.timestamp + RECOVERY_DELAY
        });

        hourlyVolume += amount;

        emit Deposited(transferId, msg.sender, recipient, amount, sorobanTxHash);
    }

    function release(
        bytes32 transferId,
        bytes32 sorobanTxHash,
        bytes32 relayerSignature
    ) external whenBridgeActive nonReentrant {
        BridgeTransfer storage transfer = transfers[transferId];
        require(transfer.status == Status.Deposited, "Invalid status");
        require(transfer.sorobanTxHash == sorobanTxHash, "Invalid Soroban TX");

        (address relayer, bool valid) = recoverRelayer(
            transferId,
            sorobanTxHash,
            relayerSignature
        );
        require(valid, "Invalid relayer signature");
        require(authorizedRelayers[relayer], "Unauthorized relayer");

        transfer.status = Status.Released;

        token.safeTransfer(transfer.recipient, transfer.amount);

        totalVerifications += 1;

        emit Released(transferId, transfer.recipient, transfer.amount);
    }

    function emergencyRefund(bytes32 transferId) external nonReentrant {
        BridgeTransfer storage transfer = transfers[transferId];
        require(
            transfer.status == Status.Deposited || transfer.status == Status.Releasing,
            "Invalid status for refund"
        );
        require(block.timestamp >= transfer.recoveryDeadline, "Recovery not yet available");
        require(
            transfer.depositor == msg.sender || owner() == msg.sender,
            "Not authorized"
        );

        transfer.status = Status.Refunded;

        token.safeTransfer(transfer.depositor, transfer.amount);

        emit Refunded(transferId, transfer.depositor, transfer.amount);
    }

    function addRelayer(address relayer) external onlyOwner {
        authorizedRelayers[relayer] = true;
        emit RelayerAdded(relayer);
    }

    function removeRelayer(address relayer) external onlyOwner {
        authorizedRelayers[relayer] = false;
        emit RelayerRemoved(relayer);
    }

    function pause() external onlyOwner {
        bridgeHalted = true;
        emit CircuitBreakerTriggered("manual");
    }

    function unpause() external onlyOwner {
        bridgeHalted = false;
        emit CircuitBreakerReset();
    }

    function recoverRelayer(
        bytes32 transferId,
        bytes32 sorobanTxHash,
        bytes32 signature
    ) internal pure returns (address relayer, bool valid) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(transferId, sorobanTxHash, block.chainid)
        );
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        assembly {
            relayer := ecrecover(ethSignedMessageHash, mload(add(signature, 32)), mload(add(signature, 64)), mload(signature))
        }
        valid = relayer != address(0) && authorizedRelayers[relayer];
    }

    function checkCircuitBreaker() internal {
        if (block.timestamp - hourlyVolumeStart > 1 hours) {
            hourlyVolumeStart = block.timestamp;
            hourlyVolume = 0;
        }

        if (hourlyVolume > MAX_HOURLY_VOLUME) {
            bridgeHalted = true;
            emit CircuitBreakerTriggered("Hourly volume exceeded");
            return;
        }

        if (totalVerifications > 100) {
            uint256 failureRateBps = (failedVerifications * 10000) / totalVerifications;
            if (failureRateBps > MAX_FAILURE_RATE_BPS) {
                bridgeHalted = true;
                emit CircuitBreakerTriggered("Failure rate exceeded");
                return;
            }
        }
    }

    function getTransfer(bytes32 transferId) external view returns (BridgeTransfer memory) {
        return transfers[transferId];
    }

    function getBridgeStatus() external view returns (bool, uint256, uint256, uint256) {
        return (bridgeHalted, hourlyVolume, totalVerifications, failedVerifications);
    }
}
