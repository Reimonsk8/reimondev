// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Base Sepolia demo token. It has no monetary value.
contract Casino888TestToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address => uint256) public nextClaimAt;

    constructor() ERC20("Casino888 Test Token - No Value", "C888T") {}

    function claimTestTokens() external {
        require(block.timestamp >= nextClaimAt[msg.sender], "Faucet cooldown");
        nextClaimAt[msg.sender] = block.timestamp + FAUCET_COOLDOWN;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
