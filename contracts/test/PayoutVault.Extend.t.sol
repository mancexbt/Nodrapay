// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultExtendTest is PayoutVaultTestBase {
    /// 1000e6 over 10 steps of 100s (100e6 per step), starting now, cancelable, Payroll kind.
    function _payroll(bool cancelable) internal returns (uint256) {
        return _schedK(
            address(usdc), alice, PayoutVault.Kind.Payroll, cancelable, 1000e6, uint64(T0), 0, 100, 10
        );
    }

    // ---------- happy path ----------

    function test_Extend_PullsExactFundingAndUpdatesSchedule() public {
        uint256 id = _payroll(true);
        uint256 funderBefore = usdc.balanceOf(funder);
        uint256 vaultBefore = usdc.balanceOf(address(vault));

        vm.expectEmit(true, false, false, true, address(vault));
        emit PayoutVault.ScheduleExtended(id, 5, 500e6, 1500e6);
        vm.prank(funder);
        vault.extendSchedule(id, 5);

        assertEq(funderBefore - usdc.balanceOf(funder), 500e6);
        assertEq(usdc.balanceOf(address(vault)) - vaultBefore, 500e6);
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertEq(s.total, 1500e6);
        assertEq(s.steps, 15);
        assertEq(s.stepDuration, 100);
        assertEq(s.start, uint64(T0));
        assertEq(s.claimed, 0);
    }

    function test_Extend_TwiceKeepsPerStepRate() public {
        uint256 id = _payroll(false);
        vm.startPrank(funder);
        vault.extendSchedule(id, 2);
        vault.extendSchedule(id, 3);
        vm.stopPrank();
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertEq(s.steps, 15);
        assertEq(s.total, 1500e6);
    }

    function test_Extend_WorksOnPayrollBatchSchedule() public {
        address[] memory bens = new address[](2);
        bens[0] = alice;
        bens[1] = bob;
        uint256[] memory totals = new uint256[](2);
        totals[0] = 300e6;
        totals[1] = 600e6;
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, true, uint64(T0), 60, 3, MEMO);
        vm.prank(funder);
        vault.extendSchedule(ids[1], 2);
        assertEq(vault.getSchedule(ids[1]).total, 1000e6); // 200e6 per step * 5
        assertEq(vault.getSchedule(ids[0]).total, 300e6);
    }

    function test_Extend_ExtendedStepsUnlockAtSameRate() public {
        uint256 id = _payroll(false);
        vm.prank(funder);
        vault.extendSchedule(id, 10); // 20 steps, 2000e6 total
        skip(1500); // 15 steps done
        assertEq(vault.unlockedAmount(id), 1500e6);
        skip(500);
        assertEq(vault.unlockedAmount(id), 2000e6);
        vault.release(id);
        assertEq(usdc.balanceOf(alice), 2000e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Extend_AfterPartialClaim_BeneficiaryKeepsClaimed() public {
        uint256 id = _payroll(false);
        skip(350);
        vault.release(id);
        assertEq(usdc.balanceOf(alice), 300e6);
        vm.prank(funder);
        vault.extendSchedule(id, 10);
        assertEq(vault.unlockedAmount(id), 300e6);
        assertEq(vault.releasable(id), 0);
        skip(100);
        assertEq(vault.releasable(id), 100e6);
    }

    function test_Extend_ThenCancelRefundsOnlyUnvested() public {
        uint256 id = _payroll(true);
        vm.prank(funder);
        vault.extendSchedule(id, 10); // 2000e6
        skip(350); // 3 steps -> 300e6 unlocked
        uint256 before = usdc.balanceOf(funder);
        vm.prank(funder);
        vault.cancel(id);
        assertEq(usdc.balanceOf(funder) - before, 1700e6);
        assertEq(vault.getSchedule(id).total, 300e6);
        assertEq(usdc.balanceOf(address(vault)), 300e6);
    }

    // ---------- unlock continuity ----------

    function test_Extend_UnlockContinuityAtEveryPastStep() public {
        uint256 id = _payroll(false);
        uint256[11] memory before;
        for (uint256 k; k <= 10; ++k) {
            vm.warp(T0 + k * 100 + 37);
            if (k == 10) vm.warp(T0 + 1000); // exact end
            before[k] = vault.unlockedAmount(id);
        }
        vm.prank(funder);
        vault.extendSchedule(id, 7);
        for (uint256 k; k <= 10; ++k) {
            vm.warp(T0 + k * 100 + 37);
            if (k == 10) vm.warp(T0 + 1000);
            // warping backwards is fine for a pure view of schedule math
            assertEq(vault.unlockedAmount(id), before[k], "unlock changed for passed period");
        }
    }

    function test_Extend_ClaimedNeverExceedsUnlocked_AfterFullyClaimedThenExtended() public {
        uint256 id = _payroll(false);
        skip(5000);
        vault.release(id); // claims all 1000e6
        vm.prank(funder);
        vault.extendSchedule(id, 4);
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertLe(s.claimed, vault.unlockedAmount(id));
        // schedule math is anchored to start, so the long-passed time unlocks extra periods immediately
        assertEq(vault.unlockedAmount(id), 1400e6);
        assertEq(vault.releasable(id), 400e6);
    }

    function _mkFuzzSchedule(uint256 perStep, uint256 steps, uint256 stepDur, uint256 cliffSeed)
        internal
        returns (uint256 id)
    {
        uint256 cliff = bound(cliffSeed, 0, steps * stepDur);
        id = _schedK(
            address(usdc), alice, PayoutVault.Kind.Payroll, true, perStep * steps, uint64(T0),
            uint64(cliff), uint64(stepDur), uint32(steps)
        );
    }

    function testFuzz_Extend_UnlockContinuityAndClaimedBound(
        uint256 perStep,
        uint256 steps,
        uint256 stepDur,
        uint256 cliffSeed,
        uint256 extra,
        uint256 t1,
        uint256 t2
    ) public {
        perStep = bound(perStep, 1, 1e9);
        steps = bound(steps, 1, 1000);
        stepDur = bound(stepDur, 1, 1e5);
        extra = bound(extra, 1, 1000);
        uint256 id = _mkFuzzSchedule(perStep, steps, stepDur, cliffSeed);
        t1 = bound(t1, 0, steps * stepDur * 2);
        t2 = bound(t2, t1, steps * stepDur * 2);

        vm.warp(T0 + t1);
        if (vault.releasable(id) != 0) vault.release(id);
        vm.warp(T0 + t2);
        uint256 unlockedBefore = vault.unlockedAmount(id);

        vm.prank(funder);
        vault.extendSchedule(id, uint32(extra));
        _assertAfterExtend(id, perStep * (steps + extra), steps + extra, unlockedBefore, t2 <= steps * stepDur);
    }

    function _assertAfterExtend(uint256 id, uint256 expTotal, uint256 expSteps, uint256 unlockedBefore, bool withinOrig)
        internal
        view
    {
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertEq(s.total, expTotal);
        assertEq(s.steps, expSteps);
        uint256 unlockedAfter = vault.unlockedAmount(id);
        assertLe(s.claimed, unlockedAfter, "claimed exceeds unlocked");
        assertGe(unlockedAfter, unlockedBefore, "unlock regressed");
        if (withinOrig) assertEq(unlockedAfter, unlockedBefore, "unlock changed within original duration");
        assertLe(unlockedAfter, s.total);
    }

    // ---------- reverts ----------

    function test_RevertExtend_OnlyFunder() public {
        uint256 id = _payroll(true);
        address[3] memory bad = [alice, stranger, bob];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(PayoutVault.Unauthorized.selector);
            vault.extendSchedule(id, 1);
        }
    }

    function test_RevertExtend_UnknownSchedule() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownSchedule.selector, 7));
        vault.extendSchedule(7, 1);
    }

    function test_RevertExtend_NonPayrollKinds() public {
        for (uint256 k; k < 9; ++k) {
            PayoutVault.Kind kind = PayoutVault.Kind(k);
            if (kind == PayoutVault.Kind.Payroll) continue;
            bool cancelable = kind == PayoutVault.Kind.Scheduled || kind == PayoutVault.Kind.Vesting
                || kind == PayoutVault.Kind.Claim || kind == PayoutVault.Kind.Grant;
            uint256 id = _schedK(address(usdc), alice, kind, cancelable, 1000e6, uint64(T0), 0, 100, 10);
            vm.prank(funder);
            vm.expectRevert(PayoutVault.NotExtendable.selector);
            vault.extendSchedule(id, 1);
        }
    }

    function test_RevertExtend_Cancelled() public {
        uint256 id = _payroll(true);
        skip(250);
        vm.startPrank(funder);
        vault.cancel(id);
        vm.expectRevert(PayoutVault.ScheduleAlreadyCancelled.selector);
        vault.extendSchedule(id, 1);
        vm.stopPrank();
    }

    function test_RevertExtend_ZeroExtraSteps() public {
        uint256 id = _payroll(true);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.extendSchedule(id, 0);
    }

    function test_RevertExtend_TotalNotDivisibleBySteps() public {
        uint256 id = _schedK(address(usdc), alice, PayoutVault.Kind.Payroll, true, 1000e6 + 1, uint64(T0), 0, 100, 10);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.NotExtendable.selector);
        vault.extendSchedule(id, 1);
    }

    function test_Extend_ExactlyToMaxDurationAllowedAndOneMoreReverts() public {
        // 10 steps, 1 unit per step, 100s each; MAX_DURATION / 100 = 6_307_200 steps
        uint256 id = _schedK(address(usdc), alice, PayoutVault.Kind.Payroll, false, 10, uint64(T0), 0, 100, 10);
        uint256 maxSteps = vault.MAX_DURATION() / 100;
        assertEq(maxSteps, 6_307_200);

        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.extendSchedule(id, uint32(maxSteps - 10 + 1));

        vault.extendSchedule(id, uint32(maxSteps - 10));
        vm.stopPrank();
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        assertEq(s.steps, maxSteps);
        assertEq(uint256(s.stepDuration) * s.steps, vault.MAX_DURATION());
        assertEq(s.total, maxSteps);

        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.extendSchedule(id, 1);
    }

    function test_RevertExtend_HugeStepsCountOverflowsDurationBound() public {
        uint256 id = _schedK(address(usdc), alice, PayoutVault.Kind.Payroll, false, 10, uint64(T0), 0, 100, 10);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.extendSchedule(id, type(uint32).max);
    }

    function test_RevertExtend_FailedExtendChangesNothing() public {
        uint256 id = _schedK(address(usdc), alice, PayoutVault.Kind.Payroll, false, 10, uint64(T0), 0, 100, 10);
        uint256 bal = usdc.balanceOf(address(vault));
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidScheduleTiming.selector);
        vault.extendSchedule(id, type(uint32).max);
        assertEq(vault.getSchedule(id).steps, 10);
        assertEq(vault.getSchedule(id).total, 10);
        assertEq(usdc.balanceOf(address(vault)), bal);
    }

    function test_RevertExtend_InsufficientAllowance() public {
        uint256 id = _payroll(true);
        vm.startPrank(funder);
        usdc.approve(address(vault), 0);
        vm.expectRevert();
        vault.extendSchedule(id, 1);
        vm.stopPrank();
        assertEq(vault.getSchedule(id).steps, 10);
    }
}
