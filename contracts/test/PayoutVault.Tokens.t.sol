// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";
import {MockFeeToken} from "../test-helpers/MockFeeToken.sol";

contract PayoutVaultTokensTest is PayoutVaultTestBase {
    MockFeeToken internal fee;
    uint64 internal DEADLINE;

    function setUp() public override {
        super.setUp();
        DEADLINE = uint64(T0 + 30 days);
        fee = new MockFeeToken();
        fee.mint(funder, 1_000_000e18);
        vm.prank(funder);
        fee.approve(address(vault), type(uint256).max);
    }

    // ---------- multiple tokens in one vault ----------

    function test_MultiToken_EscrowAccountingIsPerToken() public {
        uint256 idU = _escrowT(address(usdc), arbiter, 100e6, DEADLINE);
        uint256 idD = _escrowT(address(dai), arbiter, 7e18, DEADLINE);

        assertEq(address(vault.getEscrow(idU).token), address(usdc));
        assertEq(address(vault.getEscrow(idD).token), address(dai));
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        assertEq(dai.balanceOf(address(vault)), 7e18);

        vm.prank(funder);
        vault.releaseEscrow(idD, 3e18);
        assertEq(dai.balanceOf(alice), 3e18);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(dai.balanceOf(address(vault)), 4e18);
        assertEq(usdc.balanceOf(address(vault)), 100e6);

        vm.prank(arbiter);
        vault.refundEscrow(idU, 40e6);
        assertEq(usdc.balanceOf(funder), FUNDS - 60e6);
        assertEq(dai.balanceOf(funder), DAI_FUNDS - 7e18); // dai: 7 funded, none refunded
        assertEq(usdc.balanceOf(address(vault)), 60e6);
        assertEq(dai.balanceOf(address(vault)), 4e18);
        assertEq(vault.escrowRemaining(idU), 60e6);
        assertEq(vault.escrowRemaining(idD), 4e18);
    }

    function test_MultiToken_ScheduleAccountingIsPerToken() public {
        uint256 idU = _schedK(address(usdc), alice, PayoutVault.Kind.Vesting, true, 1000e6, uint64(T0), 0, 100, 10);
        uint256 idD = _schedK(address(dai), alice, PayoutVault.Kind.Grant, true, 500e18, uint64(T0), 0, 100, 10);
        assertEq(address(vault.getSchedule(idU).token), address(usdc));
        assertEq(address(vault.getSchedule(idD).token), address(dai));

        vm.warp(T0 + 400);
        vault.release(idD);
        assertEq(dai.balanceOf(alice), 200e18);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(vault.releasable(idU), 400e6);

        vm.prank(alice);
        vault.releaseTo(idU, bob);
        assertEq(usdc.balanceOf(bob), 400e6);
        assertEq(dai.balanceOf(bob), 0);

        // cancel the DAI schedule: only DAI is refunded
        uint256 usdcFunderBefore = usdc.balanceOf(funder);
        uint256 daiFunderBefore = dai.balanceOf(funder);
        vm.prank(funder);
        vault.cancel(idD);
        assertEq(dai.balanceOf(funder) - daiFunderBefore, 300e18);
        assertEq(usdc.balanceOf(funder), usdcFunderBefore);
        assertEq(dai.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 600e6);
    }

    function test_MultiToken_PayrollBatchPullsOnlyBatchToken() public {
        address[] memory bens = new address[](2);
        uint256[] memory totals = new uint256[](2);
        bens[0] = alice;
        bens[1] = bob;
        totals[0] = 10e18;
        totals[1] = 20e18;
        vm.prank(funder);
        uint256[] memory ids = vault.createPayrollBatch(address(dai), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertEq(dai.balanceOf(address(vault)), 30e18);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(address(vault.getSchedule(ids[0]).token), address(dai));
        assertEq(address(vault.getSchedule(ids[1]).token), address(dai));
        vm.warp(T0 + 1000);
        vault.release(ids[1]);
        assertEq(dai.balanceOf(bob), 20e18);
        assertEq(dai.balanceOf(address(vault)), 10e18);
    }

    function test_MultiToken_EventsCarryToken() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.EscrowCreated(1, funder, alice, address(dai), address(0), 5e18, DEADLINE, MEMO);
        _escrowT(address(dai), address(0), 5e18, DEADLINE);

        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.ScheduleCreated(
            1, funder, bob, address(dai), PayoutVault.Kind.Claim, 9e18, uint64(T0), 0, 10, 3
        );
        _schedK(address(dai), bob, PayoutVault.Kind.Claim, false, 9e18, uint64(T0), 0, 10, 3);
    }

    function test_MultiToken_SameAddressDifferentTokensAreIndependentSchedules() public {
        _schedK(address(usdc), alice, PayoutVault.Kind.Vesting, false, 100e6, uint64(T0), 0, 10, 10);
        _schedK(address(dai), alice, PayoutVault.Kind.Vesting, false, 100e18, uint64(T0), 0, 10, 10);
        assertEq(vault.scheduleIdsOf(alice).length, 2);
        vm.warp(T0 + 50);
        vault.release(1);
        assertEq(usdc.balanceOf(alice), 50e6);
        assertEq(dai.balanceOf(alice), 0);
        vault.release(2);
        assertEq(dai.balanceOf(alice), 50e18);
    }

    // ---------- invalid tokens ----------

    function test_Escrow_RevertsZeroToken() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidToken.selector);
        vault.createEscrow(address(0), alice, address(0), 1e6, DEADLINE, MEMO, _noMs());
    }

    function test_Escrow_RevertsNonContractToken() public {
        address[3] memory eoas = [bob, stranger, address(0xBEEF)];
        for (uint256 i; i < 3; ++i) {
            vm.prank(funder);
            vm.expectRevert(PayoutVault.InvalidToken.selector);
            vault.createEscrow(eoas[i], alice, address(0), 1e6, DEADLINE, MEMO, _noMs());
        }
    }

    function test_Schedule_RevertsZeroAndNonContractToken() public {
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidToken.selector);
        vault.createSchedule(address(0), alice, PayoutVault.Kind.Vesting, false, 1e6, uint64(T0), 0, 10, 10, MEMO);
        vm.expectRevert(PayoutVault.InvalidToken.selector);
        vault.createSchedule(bob, alice, PayoutVault.Kind.Vesting, false, 1e6, uint64(T0), 0, 10, 10, MEMO);
        vm.stopPrank();
    }

    function test_Payroll_RevertsZeroAndNonContractToken() public {
        address[] memory bens = new address[](1);
        uint256[] memory totals = new uint256[](1);
        bens[0] = alice;
        totals[0] = 1e6;
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidToken.selector);
        vault.createPayrollBatch(address(0), bens, totals, false, uint64(T0), 10, 5, MEMO);
        vm.expectRevert(PayoutVault.InvalidToken.selector);
        vault.createPayrollBatch(bob, bens, totals, false, uint64(T0), 10, 5, MEMO);
        vm.stopPrank();
    }

    function test_InvalidToken_StateUnchanged() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidToken.selector);
        vault.createEscrow(bob, alice, address(0), 1e6, DEADLINE, MEMO, _noMs());
        assertEq(vault.nextEscrowId(), 1);
        assertEq(vault.escrowIdsOf(alice).length, 0);
    }

    function test_Schedule_TokenEqualsBeneficiaryRejected() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createSchedule(address(dai), address(dai), PayoutVault.Kind.Vesting, false, 1e6, uint64(T0), 0, 10, 10, MEMO);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.createEscrow(address(dai), address(dai), address(0), 1e6, DEADLINE, MEMO, _noMs());
    }

    function test_ReleaseTo_RejectsScheduleTokenAsRecipient() public {
        uint256 idD = _schedK(address(dai), alice, PayoutVault.Kind.Vesting, false, 10e18, uint64(T0), 0, 10, 10);
        vm.warp(T0 + 50);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
        vault.releaseTo(idD, address(dai));
        // another token's address is a distinct address and is not blocked
        vm.prank(alice);
        vault.releaseTo(idD, address(usdc));
        assertEq(dai.balanceOf(address(usdc)), 5e18);
    }

    // ---------- fee-on-transfer / non-exact tokens ----------

    function test_FeeToken_ZeroFeeBehavesNormally() public {
        uint256 id = _escrowT(address(fee), address(0), 100e18, DEADLINE);
        assertEq(fee.balanceOf(address(vault)), 100e18);
        assertEq(vault.escrowRemaining(id), 100e18);
    }

    function test_FeeToken_EscrowRejected() public {
        fee.setFeeBps(100); // 1%
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnsupportedToken.selector);
        vault.createEscrow(address(fee), alice, address(0), 100e18, DEADLINE, MEMO, _noMs());
        assertEq(vault.nextEscrowId(), 1);
        assertEq(fee.balanceOf(address(vault)), 0);
        assertEq(fee.balanceOf(funder), 1_000_000e18);
    }

    function test_FeeToken_ScheduleRejected() public {
        fee.setFeeBps(1);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnsupportedToken.selector);
        vault.createSchedule(address(fee), alice, PayoutVault.Kind.Vesting, false, 100e18, uint64(T0), 0, 10, 10, MEMO);
        assertEq(vault.nextScheduleId(), 1);
        assertEq(vault.scheduleIdsOf(alice).length, 0);
    }

    function test_FeeToken_PayrollRejected() public {
        fee.setFeeBps(500);
        address[] memory bens = new address[](2);
        uint256[] memory totals = new uint256[](2);
        bens[0] = alice;
        bens[1] = bob;
        totals[0] = 10e18;
        totals[1] = 10e18;
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnsupportedToken.selector);
        vault.createPayrollBatch(address(fee), bens, totals, false, uint64(T0), 10, 5, MEMO);
        assertEq(vault.nextScheduleId(), 1);
    }

    function test_FeeToken_OverDeliveringTokenRejectedToo() public {
        fee.setBonus(1);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnsupportedToken.selector);
        vault.createEscrow(address(fee), alice, address(0), 100e18, DEADLINE, MEMO, _noMs());
    }

    function test_FeeToken_RejectionDoesNotAffectOtherTokens() public {
        _escrowT(address(usdc), address(0), 10e6, DEADLINE);
        fee.setFeeBps(100);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.UnsupportedToken.selector);
        vault.createEscrow(address(fee), alice, address(0), 1e18, DEADLINE, MEMO, _noMs());
        assertEq(usdc.balanceOf(address(vault)), 10e6);
        assertEq(vault.nextEscrowId(), 2);
    }
}
