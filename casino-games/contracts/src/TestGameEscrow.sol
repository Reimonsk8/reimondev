// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Testnet-only escrow for C888T. No production or mainnet deployment.
contract TestGameEscrow is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Wager {
        address player;
        uint128 amount;
        uint64 refundAt;
        bool settled;
    }

    IERC20 public immutable token;
    mapping(bytes32 => Wager) public wagers;

    function wagerKey(address player, bytes32 roundId) public pure returns (bytes32) {
        return keccak256(abi.encode(player, roundId));
    }

    event WagerLocked(bytes32 indexed roundId, address indexed player, uint256 amount, uint256 refundAt);
    event WagerSettled(bytes32 indexed roundId, address indexed player, uint256 payout);
    event WagerRefunded(bytes32 indexed roundId, address indexed player, uint256 amount);

    constructor(IERC20 testToken, address operator) Ownable(operator) {
        require(address(testToken) != address(0), "Zero token");
        token = testToken;
    }

    function lock(bytes32 roundId, uint128 amount, uint64 refundAt) external nonReentrant whenNotPaused {
        require(roundId != bytes32(0) && amount > 0, "Invalid wager");
        require(refundAt > block.timestamp, "Invalid timeout");
        bytes32 key = wagerKey(msg.sender, roundId);
        require(wagers[key].player == address(0), "Round exists");
        wagers[key] = Wager(msg.sender, amount, refundAt, false);
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit WagerLocked(roundId, msg.sender, amount, refundAt);
    }

    function settle(address player, bytes32 roundId, uint128 payout) external onlyOwner nonReentrant {
        Wager storage wager = wagers[wagerKey(player, roundId)];
        require(wager.player != address(0) && !wager.settled, "Invalid round");
        wager.settled = true;
        if (payout > 0) token.safeTransfer(wager.player, payout);
        emit WagerSettled(roundId, wager.player, payout);
    }

    function refund(bytes32 roundId) external nonReentrant {
        Wager storage wager = wagers[wagerKey(msg.sender, roundId)];
        require(wager.player == msg.sender && !wager.settled, "Invalid round");
        require(block.timestamp >= wager.refundAt, "Not refundable");
        wager.settled = true;
        token.safeTransfer(wager.player, wager.amount);
        emit WagerRefunded(roundId, wager.player, wager.amount);
    }

    function fund(uint256 amount) external nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
