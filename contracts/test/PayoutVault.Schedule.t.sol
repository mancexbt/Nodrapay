// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultScheduleTest is PayoutVaultTestBase {
    // ---------- createSchedule ----------

    function test_CreateSchedule_HappyPath() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.ScheduleCreated(1, funder, alice, address(usdc), PayoutVault.Kind.Vesting, 1000e6, uint64(T0), 50, 100, 10);
        uint256 id = _sched(true, 1000e6, uint64(T0), 50, 100, 10);
        assertEq(id, 1);
        assertEq(vault.nextScheduleId(), 2);
        assertEq(usdc.balanceOf(address(vault)), 1000e6);
        assertEq(usdc.balanceOf(funder), FUNDS - 1000e6);

        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertEq(address(s.token), address(usdc));
        assertEq(s.funder, funder);
        assertEq(s.beneficiary, alice);
        assertEq(uint256(s.kind), uint256(PayoutVault.Kind.Vesting));
        assertTrue(s.cancelable);
        assertFalse(s.cancelled);
        assertEq(s.total, 1000e6);
        assertEq(s.claimed, 0);
        assertEq(s.start, T0);
        assertEq(s.cliff, 50);
        assertEq(s.stepDuration, 100);
        assertEq(s.steps, 10);
        assertEq(s.createdAt, T0);
        assertEq(s.memo, MEMO);

        assertEq(vault.scheduleIdsOf(funder).length, 1);
        assertEq(vault.scheduleIdsOf(alice).length, 1);
        assertEq(vault.scheduleIdsOf(stranger).length, 0);
    }

    function test_CreateSchedule_StartMayBeUpToOneDayInPast() public {
        _sched(false, 10e6, uint64(T0 - 1 days), 0, 100, 10);
    }

    function test_CreateSchedule_RevertsStartTooOld() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0 - 1 days - 1), 0, 100, 10, MEMO);
    }

    function test_CreateSchedule_RevertsBadTiming() public {
        vm.startPrank(funder);
        // zero steps
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 0, 100, 0, MEMO);
        // zero step duration
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 0, 0, 10, MEMO);
        // duration exceeds 20 years
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 0, 365 days, 21, MEMO);
        // cliff greater than duration
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 1001, 100, 10, MEMO);
        // exactly 20 years and cliff == duration are allowed
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 1000, 100, 10, MEMO);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 0, 365 days, 20, MEMO);
        vm.stopPrank();
    }

    function test_CreateSchedule_RevertsInvalidBeneficiary() public {
        address[6] memory bad =
            [address(0), address(vault), address(usdc), address(1), address(0x9), address(0xFFFF)];
        for (uint256 i; i < 6; ++i) {
            vm.prank(funder);
            vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
            vault.createSchedule(address(usdc), bad[i], PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 0, 100, 10, MEMO);
        }
    }

    function test_CreateSchedule_RevertsZeroTotalAndLongMemo() public {
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 0, uint64(T0), 0, 100, 10, MEMO);
        vm.expectRevert(PayoutVault.MemoTooLong.selector);
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 1, uint64(T0), 0, 100, 10, string(new bytes(141)));
        vm.stopPrank();
    }

    function test_CreateSchedule_RevertsWithoutFunds() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.createSchedule(address(usdc), alice, PayoutVault.Kind.Scheduled, false, 10e6, uint64(T0), 0, 100, 10, MEMO);
    }

    // ---------- unlock / release ----------

    function test_Unlocked_SteppedProgression() public {
        uint256 id = _defaultSched(true);
        assertEq(vault.unlockedAmount(id), 0);
        vm.warp(T0 + 99);
        assertEq(vault.unlockedAmount(id), 0);
        vm.warp(T0 + 100);
        assertEq(vault.unlockedAmount(id), 100e6);
        vm.warp(T0 + 350);
        assertEq(vault.unlockedAmount(id), 300e6);
        assertEq(vault.releasable(id), 300e6);
        vm.warp(T0 + 1000);
        assertEq(vault.unlockedAmount(id), 1000e6);
        vm.warp(T0 + 100000);
        assertEq(vault.unlockedAmount(id), 1000e6);
    }

    function test_Unlocked_FutureStartIsZero() public {
        uint256 id = _sched(false, 1000e6, uint64(T0 + 500), 0, 100, 10);
        assertEq(vault.unlockedAmount(id), 0);
        vm.warp(T0 + 599);
        assertEq(vault.unlockedAmount(id), 0);
        vm.warp(T0 + 600);
        assertEq(vault.unlockedAmount(id), 100e6);
    }

    function test_Unlocked_CliffHoldsBackThenCatchesUp() public {
        uint256 id = _sched(false, 1000e6, uint64(T0), 450, 100, 10);
        vm.warp(T0 + 449);
        assertEq(vault.unlockedAmount(id), 0);
        vm.warp(T0 + 450); // cliff reached: 4 completed steps unlock at once
        assertEq(vault.unlockedAmount(id), 400e6);
        vm.warp(T0 + 500);
        assertEq(vault.unlockedAmount(id), 500e6);
    }

    function test_Unlocked_RoundsDownForUnevenSplit() public {
        uint256 id = _sched(false, 10, uint64(T0), 0, 1, 3);
        vm.warp(T0 + 1);
        assertEq(vault.unlockedAmount(id), 3); // 10*1/3
        vm.warp(T0 + 2);
        assertEq(vault.unlockedAmount(id), 6);
        vm.warp(T0 + 3);
        assertEq(vault.unlockedAmount(id), 10);
    }

    function test_Release_PaysBeneficiaryByAnyone() public {
        uint256 id = _defaultSched(true);
        vm.warp(T0 + 250);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.ScheduleReleased(id, alice, alice, 200e6);
        vm.prank(stranger);
        vault.release(id);
        assertEq(usdc.balanceOf(alice), 200e6);
        assertEq(vault.getSchedule(id).claimed, 200e6);
        assertEq(vault.releasable(id), 0);
        vm.warp(T0 + 5000);
        vault.release(id);
        assertEq(usdc.balanceOf(alice), 1000e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Release_RevertsNothingReleasable() public {
        uint256 id = _defaultSched(true);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.release(id);
        vm.warp(T0 + 100);
        vault.release(id);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.release(id);
    }

    function test_Release_RevertsUnknownSchedule() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 5));
        vault.release(5);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 5));
        vault.unlockedAmount(5);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 5));
        vault.releasable(5);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 5));
        vault.getSchedule(5);
    }

    // ---------- releaseTo ----------

    function test_ReleaseTo_SendsToRecipient() public {
        uint256 id = _defaultSched(false);
        vm.warp(T0 + 300);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.ScheduleReleased(id, alice, bob, 300e6);
        vm.prank(alice);
        vault.releaseTo(id, bob);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(vault.getSchedule(id).beneficiary, alice);
        assertEq(vault.getSchedule(id).claimed, 300e6);
    }

    function test_ReleaseTo_RevertsNonBeneficiary() public {
        uint256 id = _defaultSched(false);
        vm.warp(T0 + 300);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.releaseTo(id, bob);
        vm.prank(bob);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.releaseTo(id, bob);
    }

    function test_ReleaseTo_RevertsInvalidRecipient() public {
        uint256 id = _defaultSched(false);
        vm.warp(T0 + 300);
        address[3] memory bad = [address(0), address(vault), address(usdc)];
        for (uint256 i; i < 3; ++i) {
            vm.prank(alice);
            vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
            vault.releaseTo(id, bad[i]);
        }
    }

    function test_ReleaseTo_RevertsNothingReleasable() public {
        uint256 id = _defaultSched(false);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.releaseTo(id, bob);
    }

    function test_ReleaseTo_RevertsUnknownSchedule() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 3));
        vault.releaseTo(3, bob);
    }

    // ---------- cancel ----------

    function test_Cancel_RefundsUnvestedKeepsVestedClaimable() public {
        uint256 id = _defaultSched(true);
        vm.warp(T0 + 350);
        vm.expectEmit(true, false, false, true, address(vault));
        emit PayoutVault.ScheduleCancelled(id, 700e6, 300e6);
        vm.prank(funder);
        vault.cancel(id);

        assertEq(usdc.balanceOf(funder), FUNDS - 300e6);
        assertEq(usdc.balanceOf(address(vault)), 300e6);
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertTrue(s.cancelled);
        assertEq(s.total, 300e6);

        // frozen irrespective of clock
        vm.warp(T0 + 100000);
        assertEq(vault.unlockedAmount(id), 300e6);
        assertEq(vault.releasable(id), 300e6);
        vault.release(id);
        assertEq(usdc.balanceOf(alice), 300e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Cancel_AfterPartialClaim() public {
        uint256 id = _defaultSched(true);
        vm.warp(T0 + 200);
        vault.release(id); // 200 claimed
        vm.warp(T0 + 500);
        vm.prank(funder);
        vault.cancel(id);
        assertEq(vault.releasable(id), 300e6);
        assertEq(usdc.balanceOf(address(vault)), 300e6);
        vm.prank(alice);
        vault.releaseTo(id, bob);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(alice), 200e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Cancel_BeforeCliffRefundsEverything() public {
        uint256 id = _sched(true, 1000e6, uint64(T0), 500, 100, 10);
        vm.warp(T0 + 100);
        vm.prank(funder);
        vault.cancel(id);
        assertEq(usdc.balanceOf(funder), FUNDS);
        assertEq(usdc.balanceOf(address(vault)), 0);
        vm.warp(T0 + 5000);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.release(id);
    }

    function test_Cancel_AfterFullVestRefundsNothing() public {
        uint256 id = _defaultSched(true);
        vm.warp(T0 + 2000);
        vm.expectEmit(true, false, false, true, address(vault));
        emit PayoutVault.ScheduleCancelled(id, 0, 1000e6);
        vm.prank(funder);
        vault.cancel(id);
        assertEq(usdc.balanceOf(address(vault)), 1000e6);
        assertEq(vault.releasable(id), 1000e6);
    }

    function test_Cancel_RevertsNonFunder() public {
        uint256 id = _defaultSched(true);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.cancel(id);
    }

    function test_Cancel_RevertsNotCancelable() public {
        uint256 id = _defaultSched(false);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.ScheduleNotCancelable.selector);
        vault.cancel(id);
    }

    function test_Cancel_RevertsAlreadyCancelled() public {
        uint256 id = _defaultSched(true);
        vm.startPrank(funder);
        vault.cancel(id);
        vm.expectRevert(PayoutVault.ScheduleAlreadyCancelled.selector);
        vault.cancel(id);
        vm.stopPrank();
    }

    function test_Cancel_RevertsUnknownSchedule() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 9));
        vault.cancel(9);
    }

    // ---------- payroll batch ----------

    function _batch(uint256 n, uint256 each) internal returns (address[] memory bens, uint256[] memory totals) {
        bens = new address[](n);
        totals = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            bens[i] = address(uint160(0x100000 + i));
            totals[i] = each + i;
        }
    }

    function test_PayrollBatch_HappyPath() public {
        (address[] memory bens, uint256[] memory totals) = _batch(3, 100e6);
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.ScheduleCreated(1, funder, bens[0], address(usdc), PayoutVault.Kind.Payroll, totals[0], uint64(T0), 0, 100, 10);
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, true, uint64(T0), 100, 10, MEMO);

        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[2], 3);
        assertEq(usdc.balanceOf(address(vault)), 300e6 + 3);
        assertEq(usdc.balanceOf(funder), FUNDS - 300e6 - 3);
        for (uint256 i; i < 3; ++i) {
            PayoutVault.Schedule memory s = vault.getSchedule(ids[i]);
            assertEq(s.beneficiary, bens[i]);
            assertEq(s.total, totals[i]);
            assertEq(uint256(s.kind), uint256(PayoutVault.Kind.Payroll));
            assertEq(s.cliff, 0);
            assertTrue(s.cancelable);
            assertEq(vault.scheduleIdsOf(bens[i]).length, 1);
        }
        assertEq(vault.scheduleIdsOf(funder).length, 3);
    }

    function test_PayrollBatch_RepeatedBeneficiaryGetsDistinctSchedules() public {
        address[] memory bens = new address[](2);
        uint256[] memory totals = new uint256[](2);
        bens[0] = alice;
        bens[1] = alice;
        totals[0] = 10e6;
        totals[1] = 20e6;
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertTrue(ids[0] != ids[1]);
        assertEq(vault.scheduleIdsOf(alice).length, 2);
        assertEq(vault.getSchedule(ids[0]).total, 10e6);
        assertEq(vault.getSchedule(ids[1]).total, 20e6);
    }

    function test_PayrollBatch_MaxSizeAllowed() public {
        (address[] memory bens, uint256[] memory totals) = _batch(100, 1e6);
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertEq(ids.length, 100);
    }

    function test_PayrollBatch_RevertsInvalidBatch() public {
        (address[] memory bens, uint256[] memory totals) = _batch(101, 1e6);
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidBatch.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);

        (bens, totals) = _batch(0, 1e6);
        vm.expectRevert(PayoutVault.InvalidBatch.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);

        (bens,) = _batch(2, 1e6);
        (, totals) = _batch(3, 1e6);
        vm.expectRevert(PayoutVault.InvalidBatch.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
        vm.stopPrank();
    }

    function test_PayrollBatch_RevertsAtomicallyOnBadEntry() public {
        (address[] memory bens, uint256[] memory totals) = _batch(3, 1e6);
        totals[2] = 0;
        vm.prank(funder);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertEq(vault.nextScheduleId(), 1);
        assertEq(usdc.balanceOf(address(vault)), 0);

        (bens, totals) = _batch(3, 1e6);
        bens[1] = address(0xFFFF);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
    }

    function test_PayrollBatch_RevertsBadTimingAndMemo() public {
        (address[] memory bens, uint256[] memory totals) = _batch(2, 1e6);
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 0, 5, MEMO);
        vm.expectRevert(PayoutVault.MemoTooLong.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, string(new bytes(141)));
        vm.stopPrank();
    }

    function test_PayrollBatch_ReleaseAndCancelPerRecipient() public {
        (address[] memory bens, uint256[] memory totals) = _batch(2, 1000);
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, true, uint64(T0), 100, 10, MEMO);
        vm.warp(T0 + 500);
        vault.release(ids[0]);
        assertEq(usdc.balanceOf(bens[0]), 500);
        vm.prank(funder);
        vault.cancel(ids[1]);
        assertEq(vault.getSchedule(ids[1]).total, 500); // 1001 * 5 / 10 = 500
        assertEq(usdc.balanceOf(funder), FUNDS - 2001 + 501);
    }
}
