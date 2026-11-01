// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultFuzzTest is PayoutVaultTestBase {
    function _expected(uint256 total, uint256 cliff, uint256 stepDur, uint256 steps, uint256 elapsed)
        internal
        pure
        returns (uint256)
    {
        if (elapsed < cliff) return 0;
        if (elapsed >= stepDur * steps) return total;
        return Math.mulDiv(total, elapsed / stepDur, steps);
    }

    function testFuzz_SteppedUnlockMatchesFormula(
        uint256 total,
        uint256 stepDur,
        uint256 steps,
        uint256 cliff,
        uint256 elapsed
    ) public {
        total = bound(total, 1, 1e30);
        stepDur = bound(stepDur, 1, 30 days);
        steps = bound(steps, 1, 1000);
        uint256 duration = stepDur * steps;
        vm.assume(duration <= vault.MAX_DURATION());
        cliff = bound(cliff, 0, duration);
        elapsed = bound(elapsed, 0, duration + 2 * stepDur);

        usdc.mint(funder, total);
        uint256 id = _sched(false, total, uint64(T0), uint64(cliff), uint64(stepDur), uint32(steps));
        vm.warp(T0 + elapsed);

        uint256 u = vault.unlockedAmount(id);
        assertEq(u, _expected(total, cliff, stepDur, steps, elapsed));
        assertLe(u, total);
        assertEq(vault.releasable(id), u);
    }

    function testFuzz_LinearUnlockIsProportional(uint256 total, uint256 duration, uint256 elapsed) public {
        total = bound(total, 1, 1e30);
        duration = bound(duration, 1, 1_000_000);
        elapsed = bound(elapsed, 0, duration);
        usdc.mint(funder, total);
        uint256 id = _sched(false, total, uint64(T0), 0, 1, uint32(duration));
        vm.warp(T0 + elapsed);
        assertEq(vault.unlockedAmount(id), Math.mulDiv(total, elapsed, duration));
    }

    function testFuzz_UnlockMonotonicAndNeverExceedsTotal(uint256 total, uint256 t1, uint256 t2) public {
        total = bound(total, 1, 1e24);
        usdc.mint(funder, total);
        uint256 id = _sched(false, total, uint64(T0), 300, 100, 10);
        t1 = bound(t1, 0, 2000);
        t2 = bound(t2, t1, 2000);
        vm.warp(T0 + t1);
        uint256 a = vault.unlockedAmount(id);
        vm.warp(T0 + t2);
        uint256 b = vault.unlockedAmount(id);
        assertLe(a, b);
        assertLe(b, total);
    }

    function testFuzz_CliffBlocksUntilReached(uint256 cliff, uint256 elapsed) public {
        cliff = bound(cliff, 1, 1000);
        elapsed = bound(elapsed, 0, cliff - 1);
        uint256 id = _sched(false, 1000e6, uint64(T0), uint64(cliff), 100, 10);
        vm.warp(T0 + elapsed);
        assertEq(vault.unlockedAmount(id), 0);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.release(id);
    }

    function testFuzz_ReleaseConservesFunds(uint256 total, uint256 t1, uint256 t2) public {
        total = bound(total, 1, 1e24);
        t1 = bound(t1, 0, 1500);
        t2 = bound(t2, t1, 1500);
        usdc.mint(funder, total);
        uint256 id = _sched(false, total, uint64(T0), 0, 100, 10);
        uint256 got;
        vm.warp(T0 + t1);
        if (vault.releasable(id) != 0) {
            vault.release(id);
        }
        got = usdc.balanceOf(alice);
        vm.warp(T0 + t2);
        if (vault.releasable(id) != 0) {
            vault.release(id);
        }
        assertGe(usdc.balanceOf(alice), got);
        assertEq(usdc.balanceOf(alice), vault.getSchedule(id).claimed);
        assertEq(usdc.balanceOf(address(vault)), total - vault.getSchedule(id).claimed);
        assertEq(usdc.balanceOf(alice), vault.unlockedAmount(id));
    }

    function testFuzz_PayrollBatchTotals(uint256 n, uint256[20] memory raw, uint256 steps, uint256 stepDur) public {
        n = bound(n, 1, 20);
        steps = bound(steps, 1, 100);
        stepDur = bound(stepDur, 1, 30 days);
        address[] memory bens = new address[](n);
        uint256[] memory totals = new uint256[](n);
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            bens[i] = address(uint160(0x200000 + i));
            totals[i] = bound(raw[i], 1, 1e24);
            sum += totals[i];
        }
        usdc.mint(funder, sum);
        uint256 fBefore = usdc.balanceOf(funder);
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, true, uint64(T0), uint64(stepDur), uint32(steps), MEMO);

        assertEq(ids.length, n);
        assertEq(usdc.balanceOf(address(vault)), sum);
        assertEq(usdc.balanceOf(funder), fBefore - sum);
        uint256 stored;
        for (uint256 i; i < n; ++i) {
            stored += vault.getSchedule(ids[i]).total;
            assertEq(ids[i], i + 1);
        }
        assertEq(stored, sum);
    }

    function testFuzz_CancelSplitsExactly(uint256 total, uint256 elapsed, uint256 claimAt) public {
        total = bound(total, 1, 1e24);
        elapsed = bound(elapsed, 0, 1200);
        claimAt = bound(claimAt, 0, elapsed);
        usdc.mint(funder, total);
        uint256 id = _sched(true, total, uint64(T0), 0, 100, 10);

        vm.warp(T0 + claimAt);
        if (vault.releasable(id) != 0) vault.release(id);
        vm.warp(T0 + elapsed);

        uint256 frozen = vault.unlockedAmount(id);
        uint256 fBefore = usdc.balanceOf(funder);
        vm.prank(funder);
        vault.cancel(id);
        // refund + frozen == total
        assertEq(usdc.balanceOf(funder) - fBefore, total - frozen);
        assertEq(vault.getSchedule(id).total, frozen);

        // beneficiary can still get everything that vested, nothing more
        vm.warp(T0 + 10_000);
        if (vault.releasable(id) != 0) vault.release(id);
        assertEq(usdc.balanceOf(alice), frozen);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testFuzz_EscrowReleaseRefundAccounting(uint256 amount, uint256 a, uint256 b) public {
        amount = bound(amount, 1, 1e24);
        a = bound(a, 0, amount);
        b = bound(b, 0, amount - a);
        usdc.mint(funder, amount);
        uint256 id = _escrow(arbiter, amount, uint64(T0 + 1 days));
        uint256 fBefore = usdc.balanceOf(funder);

        if (a != 0) {
            vm.prank(arbiter);
            vault.releaseEscrow(id, a);
        }
        if (b != 0) {
            vm.prank(alice);
            vault.refundEscrow(id, b);
        }
        assertEq(vault.escrowRemaining(id), amount - a - b);
        assertEq(usdc.balanceOf(alice), a);
        assertEq(usdc.balanceOf(funder) - fBefore, b);
        assertEq(usdc.balanceOf(address(vault)), amount - a - b);

        PayoutVault.EscrowStatus st = vault.escrowStatus(id);
        if (a + b < amount) assertEq(uint256(st), uint256(PayoutVault.EscrowStatus.Active));
        else if (a == 0) assertEq(uint256(st), uint256(PayoutVault.EscrowStatus.Refunded));
        else assertEq(uint256(st), uint256(PayoutVault.EscrowStatus.Completed));
    }

    function testFuzz_EscrowOverRequestReverts(uint256 amount, uint256 extra) public {
        amount = bound(amount, 1, 1e24);
        extra = bound(extra, 1, 1e24);
        usdc.mint(funder, amount);
        uint256 id = _escrow(address(0), amount, uint64(T0 + 1 days));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.AmountExceedsRemaining.selector, amount + extra, amount));
        vault.releaseEscrow(id, amount + extra);
    }

    function testFuzz_DepositorRefundWindow(bool withArbiter, uint256 deadlineOffset, uint256 t) public {
        deadlineOffset = bound(deadlineOffset, 1, 365 days);
        uint64 deadline = uint64(T0 + deadlineOffset);
        uint256 availableAfter = uint256(deadline) + (withArbiter ? 7 days : 0);
        t = bound(t, T0, availableAfter + 30 days);
        uint256 id = _escrow(withArbiter ? arbiter : address(0), 100e6, deadline);

        vm.warp(t);
        vm.prank(funder);
        if (t <= availableAfter) {
            vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, availableAfter));
            vault.refundEscrow(id, 100e6);
        } else {
            vault.refundEscrow(id, 100e6);
            assertEq(usdc.balanceOf(funder), FUNDS);
        }
    }
}
