// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultKindsTest is PayoutVaultTestBase {
    PayoutVault.Kind[9] internal kinds = [
        PayoutVault.Kind.Scheduled,
        PayoutVault.Kind.Payroll,
        PayoutVault.Kind.Vesting,
        PayoutVault.Kind.InvestorLockup,
        PayoutVault.Kind.Claim,
        PayoutVault.Kind.Grant,
        PayoutVault.Kind.TreasuryLockup,
        PayoutVault.Kind.TimeLock,
        PayoutVault.Kind.LPLockup
    ];

    function _isLockup(PayoutVault.Kind k) internal pure returns (bool) {
        return k == PayoutVault.Kind.InvestorLockup || k == PayoutVault.Kind.TreasuryLockup
            || k == PayoutVault.Kind.TimeLock || k == PayoutVault.Kind.LPLockup;
    }

    // ---------- each Kind: create / release round trip ----------

    function test_Kind_NineValuesExist() public view {
        assertEq(uint256(PayoutVault.Kind.LPLockup), 8);
        assertEq(uint256(PayoutVault.Kind.TimeLock), 7);
        assertEq(uint256(PayoutVault.Kind.TreasuryLockup), 6);
    }

    function test_Kind_RoundTripCreateAndReleaseForEveryKind() public {
        for (uint256 i; i < 9; ++i) {
            PayoutVault.Kind k = kinds[i];
            uint256 id = _schedK(address(usdc), alice, k, false, 1000e6, uint64(T0), 0, 100, 10);
            assertEq(uint256(vault.getSchedule(id).kind), i);
            assertFalse(vault.getSchedule(id).cancelable);
            assertEq(vault.releasable(id), 0);
        }
        assertEq(usdc.balanceOf(address(vault)), 9000e6);

        vm.warp(T0 + 500);
        for (uint256 i; i < 9; ++i) {
            vault.release(i + 1);
        }
        assertEq(usdc.balanceOf(alice), 9 * 500e6);
        vm.warp(T0 + 1000);
        for (uint256 i; i < 9; ++i) {
            vault.release(i + 1);
            assertEq(vault.getSchedule(i + 1).claimed, 1000e6);
        }
        assertEq(usdc.balanceOf(alice), 9000e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Kind_EventCarriesKindForEveryKind() public {
        for (uint256 i; i < 9; ++i) {
            vm.expectEmit(true, true, true, true, address(vault));
            emit PayoutVault.ScheduleCreated(i + 1, funder, alice, address(dai), kinds[i], 10e18, uint64(T0), 0, 10, 10);
            _schedK(address(dai), alice, kinds[i], false, 10e18, uint64(T0), 0, 10, 10);
        }
    }

    function test_Kind_OutOfRangeValueReverts() public {
        bytes memory data = abi.encodeWithSelector(
            vault.createSchedule.selector,
            address(usdc), alice, uint256(9), false, uint256(1e6), uint64(T0), uint64(0), uint64(10), uint32(10), MEMO
        );
        vm.prank(funder);
        (bool ok,) = address(vault).call(data);
        assertFalse(ok);
        assertEq(vault.nextScheduleId(), 1);
    }

    function test_Kind_PayrollKindViaCreateScheduleAndNonLockupCancelable() public {
        // Non-lockup kinds accept cancelable=true and can be cancelled.
        for (uint256 i; i < 9; ++i) {
            if (_isLockup(kinds[i])) continue;
            uint256 id = _schedK(address(usdc), alice, kinds[i], true, 100e6, uint64(T0), 0, 100, 10);
            assertTrue(vault.getSchedule(id).cancelable);
            uint256 before = usdc.balanceOf(funder);
            vm.prank(funder);
            vault.cancel(id);
            assertEq(usdc.balanceOf(funder) - before, 100e6);
        }
    }

    // ---------- lockups ----------

    function test_Lockup_RejectsCancelableTrue() public {
        for (uint256 i; i < 9; ++i) {
            if (!_isLockup(kinds[i])) continue;
            vm.prank(funder);
            vm.expectRevert(PayoutVault.LockupMustBeNonCancelable.selector);
            vault.createSchedule(address(usdc), alice, kinds[i], true, 100e6, uint64(T0), 0, 100, 10, MEMO);
        }
        assertEq(vault.nextScheduleId(), 1);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Lockup_AcceptsCancelableFalseAndCannotBeCancelled() public {
        for (uint256 i; i < 9; ++i) {
            if (!_isLockup(kinds[i])) continue;
            uint256 id = _schedK(address(usdc), alice, kinds[i], false, 100e6, uint64(T0), 0, 100, 10);
            vm.prank(funder);
            vm.expectRevert(PayoutVault.ScheduleNotCancelable.selector);
            vault.cancel(id);
        }
    }

    function test_Lockup_RejectionAppliesToOtherTokens() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.LockupMustBeNonCancelable.selector);
        vault.createSchedule(address(dai), alice, PayoutVault.Kind.LPLockup, true, 1e18, uint64(T0), 0, 100, 10, MEMO);
    }

    function test_Lockup_CliffStillHoldsBackRelease() public {
        uint256 id = _schedK(address(usdc), alice, PayoutVault.Kind.InvestorLockup, false, 1000e6, uint64(T0), 500, 100, 10);
        vm.warp(T0 + 499);
        vm.expectRevert(PayoutVault.NothingReleasable.selector);
        vault.release(id);
        vm.warp(T0 + 500);
        vault.release(id);
        assertEq(usdc.balanceOf(alice), 500e6);
    }

    function test_Payroll_CancelableFlagStillAllowedInBatch() public {
        address[] memory bens = new address[](1);
        uint256[] memory totals = new uint256[](1);
        bens[0] = alice;
        totals[0] = 10e6;
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, true, uint64(T0), 10, 5, MEMO);
        assertTrue(vault.getSchedule(ids[0]).cancelable);
        assertEq(uint256(vault.getSchedule(ids[0]).kind), uint256(PayoutVault.Kind.Payroll));
    }

    // ---------- self-lock (beneficiary == funder) ----------

    function test_SelfLock_ScheduleReleaseReturnsFundsToFunder() public {
        uint256 id = _schedK(address(usdc), funder, PayoutVault.Kind.TimeLock, false, 1000e6, uint64(T0), 0, 100, 10);
        assertEq(vault.getSchedule(id).funder, funder);
        assertEq(vault.getSchedule(id).beneficiary, funder);
        assertEq(usdc.balanceOf(funder), FUNDS - 1000e6);
        // indexed exactly once for the shared funder/beneficiary role
        assertEq(vault.scheduleIdsOf(funder).length, 1);

        vm.warp(T0 + 300);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.ScheduleReleased(id, funder, funder, 300e6);
        vm.prank(stranger);
        vault.release(id);
        assertEq(usdc.balanceOf(funder), FUNDS - 700e6);

        vm.warp(T0 + 1000);
        vm.prank(funder);
        vault.releaseTo(id, bob);
        assertEq(usdc.balanceOf(bob), 700e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_SelfLock_CancelableSelfScheduleCancelRefundsAndKeepsVested() public {
        uint256 id = _schedK(address(usdc), funder, PayoutVault.Kind.Vesting, true, 1000e6, uint64(T0), 0, 100, 10);
        vm.warp(T0 + 400);
        vm.prank(funder);
        vault.cancel(id);
        assertEq(usdc.balanceOf(funder), FUNDS - 400e6);
        vault.release(id);
        assertEq(usdc.balanceOf(funder), FUNDS);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_SelfLock_PayrollBatchMayIncludeFunder() public {
        address[] memory bens = new address[](3);
        uint256[] memory totals = new uint256[](3);
        bens[0] = funder;
        bens[1] = alice;
        bens[2] = funder;
        totals[0] = 10e6;
        totals[1] = 20e6;
        totals[2] = 30e6;
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertEq(ids.length, 3);
        assertEq(vault.scheduleIdsOf(funder).length, 3); // once per schedule, not doubled
        assertEq(vault.scheduleIdsOf(alice).length, 1);
        vm.warp(T0 + 100);
        vault.release(ids[0]);
        vault.release(ids[2]);
        assertEq(usdc.balanceOf(funder), FUNDS - 60e6 + 40e6);
    }

    function test_SelfLock_EscrowBeneficiaryEqualDepositorStillRejected() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createEscrow(address(usdc), funder, address(0), 1e6, uint64(T0 + 1 days), MEMO, _noMs());
    }

    // ---------- reserved low-address beneficiaries ----------

    function test_LowAddress_ScheduleRejectedAtAndBelowBoundary() public {
        address[5] memory bad = [address(0), address(1), address(0x100), address(0xFFFE), address(0xFFFF)];
        for (uint256 i; i < 5; ++i) {
            vm.prank(funder);
            vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
            vault.createSchedule(address(usdc), bad[i], PayoutVault.Kind.Vesting, false, 1e6, uint64(T0), 0, 10, 10, MEMO);
        }
    }

    function test_LowAddress_FirstAddressAboveBoundaryAccepted() public {
        uint256 id = _schedK(address(usdc), address(0x10000), PayoutVault.Kind.Vesting, false, 1e6, uint64(T0), 0, 10, 10);
        assertEq(vault.getSchedule(id).beneficiary, address(0x10000));
    }

    function test_LowAddress_PayrollRejectsAnyLowEntryAtomically() public {
        address[] memory bens = new address[](3);
        uint256[] memory totals = new uint256[](3);
        bens[0] = alice;
        bens[1] = bob;
        bens[2] = address(0x9); // precompile range
        totals[0] = 1e6;
        totals[1] = 1e6;
        totals[2] = 1e6;
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createPayrollBatch(address(usdc), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertEq(vault.nextScheduleId(), 1);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testFuzz_LowAddress_AnyAddressInReservedRangeRejected(uint160 raw) public {
        raw = uint160(bound(uint256(raw), 0, 0xFFFF));
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createEscrow(address(usdc), address(raw), address(0), 1e6, uint64(T0 + 1 days), MEMO, _noMs());
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createSchedule(address(usdc), address(raw), PayoutVault.Kind.Vesting, false, 1e6, uint64(T0), 0, 10, 10, MEMO);
        vm.stopPrank();
    }

    function testFuzz_KindAndCancelableMatrix(uint8 kindRaw, bool cancelable) public {
        PayoutVault.Kind k = kinds[bound(kindRaw, 0, 8)];
        vm.prank(funder);
        if (cancelable && _isLockup(k)) {
            vm.expectRevert(PayoutVault.LockupMustBeNonCancelable.selector);
            vault.createSchedule(address(usdc), alice, k, cancelable, 1e6, uint64(T0), 0, 10, 10, MEMO);
        } else {
            uint256 id = vault.createSchedule(address(usdc), alice, k, cancelable, 1e6, uint64(T0), 0, 10, 10, MEMO);
            assertEq(vault.getSchedule(id).cancelable, cancelable);
        }
    }
}
