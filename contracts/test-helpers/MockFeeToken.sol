// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only non-standard ERC-20. Between two non-zero accounts it can burn a fee
///      (fee-on-transfer) and/or mint a bonus to the receiver (positive rebase style),
///      so the received amount differs from the requested amount.
contract MockFeeToken is ERC20 {
    uint256 public feeBps;
    uint256 public bonus;

    constructor() ERC20("Mock Fee Token", "mFEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function setBonus(uint256 b) external {
        bonus = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && (feeBps != 0 || bonus != 0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, to, value - fee);
            if (fee != 0) super._update(from, address(0), fee);
            if (bonus != 0) _mint(to, bonus);
        } else {
            super._update(from, to, value);
        }
    }
}
