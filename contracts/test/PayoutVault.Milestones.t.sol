// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultMilestonesTest is PayoutVaultTestBase {
    uint64 internal DEADLINE;

    function setUp() public override {
        super.setUp();
        DEADLINE = uint64(T0 + 30 days);
    }

    function _uniform(uint256 n, uint256 each) internal pure returns (PayoutVault.MilestoneInput[] memory ms) {
        ms = new PayoutVault.MilestoneInput[](n);
        for (uint256 i; i < n; ++i) ms[i] = PayoutVault.MilestoneInput("m", each);
    }

    function _create(PayoutVault.MilestoneInput[] memory ms, uint256 amount) internal returns (uint256 id) {
        vm.prank(funder);
        id = vault.createEscrow(address(usdc), alice, arbiter, amount, DEADLINE, MEMO, ms);
    }

    // ---------- creation: happy path ----------

    function test_CreateWithMilestones_StoresMilestonesAndFunds() public {
        uint256 before = usdc.balanceOf(funder);
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        assertEq(before - usdc.balanceOf(funder), 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        PayoutVault.Milestone[] memory ms = vault.getMilestones(id);
        assertEq(ms.length, 2);
        assertEq(ms[0].title, "first");
        assertEq(ms[0].amount, 40e6);
        assertFalse(ms[0].released);
        assertEq(ms[1].title, "second");
        assertEq(ms[1].amount, 60e6);
        assertFalse(ms[1].released);
        assertEq(vault.escrowRemaining(id), 100e6);
    }

    function test_CreateWithoutMilestones_GetMilestonesEmpty() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        assertEq(vault.getMilestones(id).length, 0);
    }

    function test_CreateWithMaxMilestones_Succeeds() public {
        assertEq(vault.MAX_MILESTONES(), 20);
        uint256 id = _create(_uniform(20, 5e6), 100e6);
        assertEq(vault.getMilestones(id).length, 20);
    }

    function test_CreateWithMaxLengthTitle_Succeeds() public {
        assertEq(vault.MAX_MILESTONE_TITLE_BYTES(), 80);
        PayoutVault.MilestoneInput[] memory ms = new PayoutVault.MilestoneInput[](1);
        ms[0] = PayoutVault.MilestoneInput(string(new bytes(80)), 10e6);
        uint256 id = _create(ms, 10e6);
        assertEq(bytes(vault.getMilestones(id)[0].title).length, 80);
    }

    function test_GetMilestones_UnknownEscrowReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 9));
        vault.getMilestones(9);
    }

    // ---------- creation: validation ----------

    function test_RevertCreate_SumBelowAmount() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MilestoneMismatch.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 100e6, DEADLINE, MEMO, _ms2(40e6, 50e6));
    }

    function test_RevertCreate_SumAboveAmount() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MilestoneMismatch.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 100e6, DEADLINE, MEMO, _ms2(60e6, 50e6));
    }

    function test_RevertCreate_SingleMilestoneOffByOne() public {
        PayoutVault.MilestoneInput[] memory ms = new PayoutVault.MilestoneInput[](1);
        ms[0] = PayoutVault.MilestoneInput("x", 100e6 + 1);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MilestoneMismatch.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 100e6, DEADLINE, MEMO, ms);
    }

    function test_RevertCreate_TooManyMilestones() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.TooManyMilestones.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 21e6, DEADLINE, MEMO, _uniform(21, 1e6));
    }

    function test_RevertCreate_ZeroMilestoneAmount() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 100e6, DEADLINE, MEMO, _ms2(0, 100e6));
    }

    function test_RevertCreate_LongTitle() public {
        PayoutVault.MilestoneInput[] memory ms = new PayoutVault.MilestoneInput[](1);
        ms[0] = PayoutVault.MilestoneInput(string(new bytes(81)), 10e6);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MilestoneTitleTooLong.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 10e6, DEADLINE, MEMO, ms);
    }

    function test_RevertCreate_FailedValidationPullsNothing() public {
        uint256 before = usdc.balanceOf(funder);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MilestoneMismatch.selector);
        vault.createEscrow(address(usdc), alice, arbiter, 100e6, DEADLINE, MEMO, _ms2(1, 1));
        assertEq(usdc.balanceOf(funder), before);
        assertEq(vault.nextEscrowId(), 1);
    }

    // ---------- releaseMilestone ----------

    function test_ReleaseMilestone_ByDepositor_PaysBeneficiaryAndEmits() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowReleased(id, alice, 40e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.MilestoneReleased(id, 0, 40e6);
        vm.prank(funder);
        vault.releaseMilestone(id, 0);

        assertEq(usdc.balanceOf(alice), 40e6);
        assertEq(vault.escrowRemaining(id), 60e6);
        PayoutVault.Milestone[] memory ms = vault.getMilestones(id);
        assertTrue(ms[0].released);
        assertFalse(ms[1].released);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Active));
    }

    function test_ReleaseMilestone_ByArbiter() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(arbiter);
        vault.releaseMilestone(id, 1);
        assertEq(usdc.balanceOf(alice), 60e6);
        assertTrue(vault.getMilestones(id)[1].released);
    }

    function test_ReleaseMilestone_AllMilestonesCompletesEscrow() public {
        uint256 id = _msEscrow(address(0), _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.startPrank(funder);
        vault.releaseMilestone(id, 1);
        vault.releaseMilestone(id, 0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(vault.escrowRemaining(id), 0);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Completed));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_RevertReleaseMilestone_UnauthorizedCallers() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        address[3] memory bad = [alice, stranger, bob];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(PayoutVault.Unauthorized.selector);
            vault.releaseMilestone(id, 0);
        }
    }

    function test_RevertReleaseMilestone_UnknownEscrow() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 5));
        vault.releaseMilestone(5, 0);
    }

    function test_RevertReleaseMilestone_IndexOutOfRange() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnknownMilestone.selector);
        vault.releaseMilestone(id, 2);
    }

    function test_RevertReleaseMilestone_OnEscrowWithoutMilestones() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnknownMilestone.selector);
        vault.releaseMilestone(id, 0);
    }

    function test_RevertReleaseMilestone_DoubleRelease() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.startPrank(funder);
        vault.releaseMilestone(id, 0);
        vm.expectRevert(PayoutVault.MilestoneAlreadyReleased.selector);
        vault.releaseMilestone(id, 0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 40e6);
    }

    function test_RevertReleaseMilestone_ExceedsRemainingAfterRefund() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(alice); // beneficiary may refund any time
        vault.refundEscrow(id, 50e6);
        assertEq(vault.escrowRemaining(id), 50e6);

        vm.startPrank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.AmountExceedsRemaining.selector, 60e6, 50e6));
        vault.releaseMilestone(id, 1);
        // the smaller milestone still fits
        vault.releaseMilestone(id, 0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 40e6);
        assertEq(vault.escrowRemaining(id), 10e6);
        // milestone 1 is permanently unpayable via milestone path; flag is untouched
        assertFalse(vault.getMilestones(id)[1].released);
    }

    // ---------- releaseEscrow on milestone escrows ----------

    function test_RevertReleaseEscrow_UseMilestonesForDepositor() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UseMilestones.selector);
        vault.releaseEscrow(id, 1e6);
    }

    function test_RevertReleaseEscrow_UseMilestonesForArbiter() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(arbiter);
        vm.expectRevert(PayoutVault.UseMilestones.selector);
        vault.releaseEscrow(id, 1e6);
    }

    function test_RevertReleaseEscrow_UnauthorizedStillCheckedFirst() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(stranger);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.releaseEscrow(id, 1e6);
    }

    function test_MilestoneEscrow_RefundStillWorks() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        uint256 before = usdc.balanceOf(funder);
        vm.prank(arbiter);
        vault.refundEscrow(id, 30e6);
        assertEq(usdc.balanceOf(funder) - before, 30e6);
        assertEq(vault.escrowRemaining(id), 70e6);
    }

    function test_NonMilestoneEscrow_ReleaseEscrowStillWorks() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseEscrow(id, 25e6);
        assertEq(usdc.balanceOf(alice), 25e6);
    }
}
