// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

abstract contract PayoutVaultTestBase is Test {
    PayoutVault internal vault;
    MockERC20 internal usdc; // 6 decimals, primary token
    MockERC20 internal dai; // 18 decimals, secondary token

    address internal funder = makeAddr("funder");
    address internal alice = makeAddr("alice"); // beneficiary
    address internal bob = makeAddr("bob");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant FUNDS = 1_000_000_000e6;
    uint256 internal constant DAI_FUNDS = 1_000_000_000e18;
    string internal constant MEMO = "memo";

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        dai = new MockERC20("Mock DAI", "mDAI", 18);
        vault = new PayoutVault();
        usdc.mint(funder, FUNDS);
        dai.mint(funder, DAI_FUNDS);
        vm.startPrank(funder);
        usdc.approve(address(vault), type(uint256).max);
        dai.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    uint64 internal constant DL_OFFSET = 30 days;

    function _noMs() internal pure returns (PayoutVault.MilestoneInput[] memory ms) {
        ms = new PayoutVault.MilestoneInput[](0);
    }

    /// Two-milestone array summing to a + b.
    function _ms2(uint256 a, uint256 b) internal pure returns (PayoutVault.MilestoneInput[] memory ms) {
        ms = new PayoutVault.MilestoneInput[](2);
        ms[0] = PayoutVault.MilestoneInput("first", a);
        ms[1] = PayoutVault.MilestoneInput("second", b);
    }

    function _msEscrow(address arb, PayoutVault.MilestoneInput[] memory ms, uint256 amount, uint64 deadline)
        internal
        returns (uint256 id)
    {
        vm.prank(funder);
        id = vault.createEscrow(address(usdc), alice, arb, amount, deadline, MEMO, ms);
    }

    function _escrowT(address token, address arb, uint256 amount, uint64 deadline) internal returns (uint256 id) {
        vm.prank(funder);
        id = vault.createEscrow(token, alice, arb, amount, deadline, MEMO, _noMs());
    }

    function _escrow(address arb, uint256 amount, uint64 deadline) internal returns (uint256 id) {
        return _escrowT(address(usdc), arb, amount, deadline);
    }

    function _schedK(
        address token,
        address ben,
        PayoutVault.Kind kind,
        bool cancelable,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 stepDur,
        uint32 steps
    ) internal returns (uint256 id) {
        vm.prank(funder);
        id = vault.createSchedule(token, ben, kind, cancelable, total, start, cliff, stepDur, steps, MEMO);
    }

    function _sched(bool cancelable, uint256 total, uint64 start, uint64 cliff, uint64 stepDur, uint32 steps)
        internal
        returns (uint256 id)
    {
        return _schedK(address(usdc), alice, PayoutVault.Kind.Vesting, cancelable, total, start, cliff, stepDur, steps);
    }

    /// 1000e6 over 10 steps of 100s, starting now, no cliff.
    function _defaultSched(bool cancelable) internal returns (uint256) {
        return _sched(cancelable, 1000e6, uint64(T0), 0, 100, 10);
    }
}
