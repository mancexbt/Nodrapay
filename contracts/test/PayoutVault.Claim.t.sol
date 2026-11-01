// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultClaimTest is PayoutVaultTestBase {
    uint64 internal DEADLINE;
    uint256 internal constant GRACE = 7 days;
    uint256 internal constant WINDOW = 30 days;

    function setUp() public override {
        super.setUp();
        DEADLINE = uint64(T0 + 30 days);
    }

    function _claimErr(uint256 opensAt) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(PayoutVault.ClaimNotAvailable.selector, opensAt);
    }

    // ---------- constants / view ----------

    function test_Constants() public view {
        assertEq(vault.CLAIM_GRACE(), 7 days);
        assertEq(vault.DISPUTE_WINDOW(), 30 days);
        assertEq(vault.ARBITER_GRACE(), 7 days);
    }

    function test_EscrowClaimOpensAt_NoArbiterAndArbiter() public {
        uint256 a = _escrow(address(0), 10e6, DEADLINE);
        uint256 b = _escrow(arbiter, 10e6, DEADLINE);
        assertEq(vault.escrowClaimOpensAt(a), uint256(DEADLINE) + 7 days);
        assertEq(vault.escrowClaimOpensAt(b), uint256(DEADLINE) + 14 days);
    }

    function test_EscrowClaimOpensAt_UnknownEscrowReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 3));
        vault.escrowClaimOpensAt(3);
    }

    // ---------- claim windows ----------

    function test_Claim_NoArbiter_ExactBoundary() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        uint256 opens = uint256(DEADLINE) + GRACE;

        vm.warp(opens - 1);
        vm.prank(alice);
        vm.expectRevert(_claimErr(opens));
        vault.claimEscrow(id);

        vm.warp(opens);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowReleased(id, alice, 100e6);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(vault.escrowRemaining(id), 0);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Completed));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Claim_WithArbiter_ExactBoundary() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        uint256 opens = uint256(DEADLINE) + 2 * GRACE;

        // the no-arbiter opening time is not enough when an arbiter exists
        vm.warp(uint256(DEADLINE) + GRACE);
        vm.prank(alice);
        vm.expectRevert(_claimErr(opens));
        vault.claimEscrow(id);

        vm.warp(opens - 1);
        vm.prank(alice);
        vm.expectRevert(_claimErr(opens));
        vault.claimEscrow(id);

        vm.warp(opens);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_Claim_BeforeDeadlineReverts() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(alice);
        vm.expectRevert(_claimErr(uint256(DEADLINE) + GRACE));
        vault.claimEscrow(id);
    }

    function test_Claim_PaysOnlyRemainingAfterPartialReleaseAndRefund() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseEscrow(id, 10e6);
        vm.prank(alice);
        vault.refundEscrow(id, 20e6);
        vm.warp(uint256(DEADLINE) + GRACE);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 10e6 + 70e6);
        assertEq(vault.escrowRemaining(id), 0);
        assertEq(vault.getEscrow(id).released, 80e6);
    }

    function test_RevertClaim_OnlyBeneficiary() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.warp(uint256(DEADLINE) + 2 * GRACE);
        address[4] memory bad = [funder, arbiter, stranger, bob];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(PayoutVault.Unauthorized.selector);
            vault.claimEscrow(id);
        }
    }

    function test_RevertClaim_UnknownEscrow() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 4));
        vault.claimEscrow(4);
    }

    function test_RevertClaim_NothingLeft() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseEscrow(id, 100e6);
        vm.warp(uint256(DEADLINE) + GRACE);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.claimEscrow(id);
    }

    function test_RevertClaim_Twice() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.warp(uint256(DEADLINE) + GRACE);
        vm.startPrank(alice);
        vault.claimEscrow(id);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.claimEscrow(id);
        vm.stopPrank();
    }

    function test_Claim_MarksAllRemainingMilestonesReleased() public {
        uint256 id = _msEscrow(address(0), _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseMilestone(id, 0);
        vm.warp(uint256(DEADLINE) + GRACE);
        vm.prank(alice);
        vault.claimEscrow(id);

        PayoutVault.Milestone[] memory ms = vault.getMilestones(id);
        assertTrue(ms[0].released);
        assertTrue(ms[1].released);
        assertEq(usdc.balanceOf(alice), 100e6);
        // released milestones can no longer be paid
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MilestoneAlreadyReleased.selector);
        vault.releaseMilestone(id, 1);
    }

    function test_Claim_AfterPartialRefundMarksMilestonesReleasedAndPaysRemainder() public {
        uint256 id = _msEscrow(address(0), _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(alice);
        vault.refundEscrow(id, 50e6);
        vm.warp(uint256(DEADLINE) + GRACE);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 50e6);
        PayoutVault.Milestone[] memory ms = vault.getMilestones(id);
        assertTrue(ms[0].released);
        assertTrue(ms[1].released);
    }

    // ---------- dispute: creation ----------

    function test_Dispute_ByDepositor_RecordsStateAndEmits() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowDisputed(id, funder);
        vm.prank(funder);
        vault.dispute(id);
        PayoutVault.Escrow memory e = vault.getEscrow(id);
        assertTrue(e.disputed);
        assertEq(e.disputedBy, funder);
        assertEq(e.disputedAt, uint64(T0));
    }

    function test_Dispute_ByBeneficiary() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        assertEq(vault.getEscrow(id).disputedBy, alice);
    }

    function test_RevertDispute_ArbiterAndStrangerUnauthorized() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(arbiter);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.dispute(id);
        vm.prank(stranger);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.dispute(id);
    }

    function test_RevertDispute_UnknownEscrow() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 1));
        vault.dispute(1);
    }

    function test_RevertDispute_NothingRemaining() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseEscrow(id, 100e6);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.dispute(id);
    }

    function test_RevertDispute_SecondWhileActive() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.AlreadyDisputed.selector);
        vault.dispute(id);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.AlreadyDisputed.selector);
        vault.dispute(id);
    }

    function test_RevertDispute_SecondAfterWithdrawal() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        vm.prank(funder);
        vault.withdrawDispute(id);
        skip(1 days);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.AlreadyDisputed.selector);
        vault.dispute(id);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.AlreadyDisputed.selector);
        vault.dispute(id);
    }

    // ---------- dispute: withdraw ----------

    function test_WithdrawDispute_ByOpener_ClearsAndEmits() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowDisputeCleared(id, alice);
        vm.prank(alice);
        vault.withdrawDispute(id);
        PayoutVault.Escrow memory e = vault.getEscrow(id);
        assertFalse(e.disputed);
        assertEq(e.disputedBy, address(0));
        assertEq(e.disputedAt, uint64(T0)); // preserved so a second dispute is impossible
    }

    function test_RevertWithdrawDispute_OnlyOpener() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        address[3] memory bad = [alice, arbiter, stranger];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(PayoutVault.Unauthorized.selector);
            vault.withdrawDispute(id);
        }
        assertTrue(vault.getEscrow(id).disputed);
    }

    function test_RevertWithdrawDispute_NotDisputed() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.NotDisputed.selector);
        vault.withdrawDispute(id);
    }

    function test_RevertWithdrawDispute_Twice() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.startPrank(funder);
        vault.dispute(id);
        vault.withdrawDispute(id);
        vm.expectRevert(PayoutVault.NotDisputed.selector);
        vault.withdrawDispute(id);
        vm.stopPrank();
    }

    function test_RevertWithdrawDispute_UnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 2));
        vault.withdrawDispute(2);
    }

    // ---------- dispute vs claim ----------

    function test_Claim_BlockedDuringDispute_AllowedAfterWindow() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        uint256 opens = uint256(DEADLINE) + GRACE;
        // open the dispute exactly when the claim window opens
        vm.warp(opens);
        vm.prank(funder);
        vault.dispute(id);

        vm.prank(alice);
        vm.expectRevert(PayoutVault.EscrowIsDisputed.selector);
        vault.claimEscrow(id);

        vm.warp(opens + WINDOW - 1);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.EscrowIsDisputed.selector);
        vault.claimEscrow(id);

        vm.warp(opens + WINDOW);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
        // dispute flag is left as-is; claim does not require it to be cleared
        assertTrue(vault.getEscrow(id).disputed);
    }

    function test_Claim_EarlyDispute_WindowEndsButClaimStillNotOpen() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        uint256 opens = uint256(DEADLINE) + GRACE;
        vm.prank(alice);
        vault.dispute(id); // at T0, window ends T0 + 30d == DEADLINE < opens

        vm.warp(T0 + WINDOW - 1);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.EscrowIsDisputed.selector);
        vault.claimEscrow(id);

        // window over, but claim window not yet open -> normal opening-time rule applies
        vm.warp(T0 + WINDOW);
        vm.prank(alice);
        vm.expectRevert(_claimErr(opens));
        vault.claimEscrow(id);

        vm.warp(opens);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_Claim_WithArbiter_DisputeWindowAndOpeningBothApply() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        uint256 opens = uint256(DEADLINE) + 2 * GRACE;
        vm.warp(opens - 10 days);
        vm.prank(alice);
        vault.dispute(id);
        // after claim opening but within dispute window -> blocked
        vm.warp(opens);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.EscrowIsDisputed.selector);
        vault.claimEscrow(id);
        vm.warp(opens - 10 days + WINDOW);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_Claim_AllowedAfterDisputeWithdrawn() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        uint256 opens = uint256(DEADLINE) + GRACE;
        vm.warp(opens);
        vm.prank(funder);
        vault.dispute(id);
        vm.prank(funder);
        vault.withdrawDispute(id);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_Claim_NothingLeftCheckedBeforeDispute() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.prank(funder);
        vault.releaseEscrow(id, 100e6);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.claimEscrow(id);
    }

    // ---------- arbiter actions clear disputes ----------

    function test_ArbiterRelease_ClearsDispute() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowDisputeCleared(id, arbiter);
        vm.prank(arbiter);
        vault.releaseEscrow(id, 10e6);
        PayoutVault.Escrow memory e = vault.getEscrow(id);
        assertFalse(e.disputed);
        assertEq(e.disputedBy, address(0));
        assertEq(e.disputedAt, uint64(T0));
    }

    function test_ArbiterRefund_ClearsDispute() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.prank(arbiter);
        vault.refundEscrow(id, 10e6);
        assertFalse(vault.getEscrow(id).disputed);
    }

    function test_ArbiterReleaseMilestone_ClearsDispute() public {
        uint256 id = _msEscrow(arbiter, _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowDisputeCleared(id, arbiter);
        vm.prank(arbiter);
        vault.releaseMilestone(id, 0);
        assertFalse(vault.getEscrow(id).disputed);
    }

    function test_ArbiterClear_ThenClaimAllowedAndNoRedispute() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        vm.prank(arbiter);
        vault.releaseEscrow(id, 10e6);

        vm.prank(alice);
        vm.expectRevert(PayoutVault.AlreadyDisputed.selector);
        vault.dispute(id);

        vm.warp(uint256(DEADLINE) + 2 * GRACE);
        vm.prank(alice);
        vault.claimEscrow(id);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_DepositorAndBeneficiaryActions_DoNotClearDispute() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        vm.prank(funder);
        vault.releaseEscrow(id, 10e6);
        assertTrue(vault.getEscrow(id).disputed);
        vm.prank(alice);
        vault.refundEscrow(id, 10e6);
        assertTrue(vault.getEscrow(id).disputed);
    }

    // ---------- disputes do not stop depositor release/refund ----------

    function test_Dispute_DoesNotStopDepositorRelease() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.prank(funder);
        vault.releaseEscrow(id, 30e6);
        assertEq(usdc.balanceOf(alice), 30e6);
        assertEq(vault.escrowRemaining(id), 70e6);
    }

    function test_Dispute_DoesNotStopMilestoneRelease() public {
        uint256 id = _msEscrow(address(0), _ms2(40e6, 60e6), 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.prank(funder);
        vault.releaseMilestone(id, 0);
        assertEq(usdc.balanceOf(alice), 40e6);
    }

    function test_Dispute_DoesNotChangeDepositorRefundTiming_NoArbiter() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(alice);
        vault.dispute(id);
        vm.warp(DEADLINE);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, uint256(DEADLINE)));
        vault.refundEscrow(id, 100e6);
        vm.warp(uint256(DEADLINE) + 1);
        uint256 before = usdc.balanceOf(funder);
        vm.prank(funder);
        vault.refundEscrow(id, 100e6);
        assertEq(usdc.balanceOf(funder) - before, 100e6);
    }

    function test_Dispute_DoesNotChangeDepositorRefundTiming_WithArbiter() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.dispute(id);
        uint256 avail = uint256(DEADLINE) + 7 days;
        vm.warp(avail);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, avail));
        vault.refundEscrow(id, 100e6);
        vm.warp(avail + 1);
        vm.prank(funder);
        vault.refundEscrow(id, 100e6);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Refunded));
    }

    function test_DepositorRefundWindowOpensBeforeBeneficiaryClaimWindow() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.warp(uint256(DEADLINE) + 1);
        vm.prank(alice);
        vm.expectRevert(_claimErr(uint256(DEADLINE) + GRACE));
        vault.claimEscrow(id);
        vm.prank(funder);
        vault.refundEscrow(id, 100e6); // depositor can already refund
        assertEq(vault.escrowRemaining(id), 0);
    }
}
