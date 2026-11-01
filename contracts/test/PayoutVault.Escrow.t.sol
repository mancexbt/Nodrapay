// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultEscrowTest is PayoutVaultTestBase {
    uint64 internal DEADLINE;

    function setUp() public override {
        super.setUp();
        DEADLINE = uint64(T0 + 30 days);
    }

    // ---------- constructor ----------

    function test_Constructor_NoArgsInitialState() public {
        PayoutVault v = new PayoutVault();
        assertEq(v.nextEscrowId(), 1);
        assertEq(v.nextScheduleId(), 1);
        assertEq(v.ARBITER_GRACE(), 7 days);
        assertEq(v.MAX_BATCH_SIZE(), 100);
        assertEq(v.MAX_MEMO_BYTES(), 140);
        assertEq(v.MAX_DURATION(), 20 * 365 days);
    }

    // ---------- createEscrow ----------

    function test_CreateEscrow_HappyPath() public {
        uint256 id = _escrow(arbiter, 500e6, DEADLINE);
        assertEq(id, 1);
        assertEq(vault.nextEscrowId(), 2);
        assertEq(usdc.balanceOf(address(vault)), 500e6);
        assertEq(usdc.balanceOf(funder), FUNDS - 500e6);

        PayoutVault.Escrow memory e = vault.getEscrow(id);
        assertEq(address(e.token), address(usdc));
        assertEq(e.depositor, funder);
        assertEq(e.beneficiary, alice);
        assertEq(e.arbiter, arbiter);
        assertEq(e.amount, 500e6);
        assertEq(e.released, 0);
        assertEq(e.refunded, 0);
        assertEq(e.deadline, DEADLINE);
        assertEq(e.createdAt, T0);
        assertEq(e.memo, MEMO);
        assertEq(vault.escrowRemaining(id), 500e6);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Active));
    }

    function test_CreateEscrow_IndexesAllRoles() public {
        uint256 id = _escrow(arbiter, 1e6, DEADLINE);
        assertEq(vault.escrowIdsOf(funder).length, 1);
        assertEq(vault.escrowIdsOf(alice).length, 1);
        assertEq(vault.escrowIdsOf(arbiter).length, 1);
        assertEq(vault.escrowIdsOf(alice)[0], id);
        assertEq(vault.escrowIdsOf(stranger).length, 0);
    }

    function test_CreateEscrow_NoArbiterNotIndexedForZero() public {
        _escrow(address(0), 1e6, DEADLINE);
        assertEq(vault.escrowIdsOf(address(0)).length, 0);
    }

    function test_CreateEscrow_EmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.EscrowCreated(1, funder, alice, address(usdc), arbiter, 5e6, DEADLINE, MEMO);
        _escrow(arbiter, 5e6, DEADLINE);
    }

    function test_CreateEscrow_MaxMemoAllowed() public {
        bytes memory m = new bytes(140);
        for (uint256 i; i < 140; ++i) m[i] = "a";
        vm.prank(funder);
        vault.createEscrow(address(usdc), alice, address(0), 1e6, DEADLINE, string(m), _noMs());
    }

    function test_CreateEscrow_RevertsMemoTooLong() public {
        bytes memory m = new bytes(141);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.MemoTooLong.selector);
        vault.createEscrow(address(usdc), alice, address(0), 1e6, DEADLINE, string(m), _noMs());
    }

    function test_CreateEscrow_RevertsInvalidBeneficiary() public {
        address[7] memory bad =
            [address(0), funder, address(vault), address(usdc), address(1), address(0x9), address(0xFFFF)];
        for (uint256 i; i < 7; ++i) {
            vm.prank(funder);
            vm.expectRevert(PayoutVault.InvalidBeneficiary.selector);
            vault.createEscrow(address(usdc), bad[i], address(0), 1e6, DEADLINE, MEMO, _noMs());
        }
    }

    function test_CreateEscrow_FirstAddressAboveReservedRangeAllowed() public {
        vm.prank(funder);
        uint256 id = vault.createEscrow(address(usdc), address(0x10000), address(0), 1e6, DEADLINE, MEMO, _noMs());
        assertEq(vault.getEscrow(id).beneficiary, address(0x10000));
    }

    function test_CreateEscrow_RevertsInvalidArbiter() public {
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidArbiter.selector);
        vault.createEscrow(address(usdc), alice, funder, 1e6, DEADLINE, MEMO, _noMs());
        vm.expectRevert(PayoutVault.InvalidArbiter.selector);
        vault.createEscrow(address(usdc), alice, alice, 1e6, DEADLINE, MEMO, _noMs());
        vm.stopPrank();
    }

    function test_CreateEscrow_RevertsZeroAmount() public {
        vm.prank(funder);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.createEscrow(address(usdc), alice, address(0), 0, DEADLINE, MEMO, _noMs());
    }

    function test_CreateEscrow_RevertsDeadlineNotInFuture() public {
        vm.startPrank(funder);
        vm.expectRevert(PayoutVault.InvalidDeadline.selector);
        vault.createEscrow(address(usdc), alice, address(0), 1e6, uint64(T0), MEMO, _noMs());
        vm.expectRevert(PayoutVault.InvalidDeadline.selector);
        vault.createEscrow(address(usdc), alice, address(0), 1e6, uint64(T0 - 1), MEMO, _noMs());
        vault.createEscrow(address(usdc), alice, address(0), 1e6, uint64(T0 + 1), MEMO, _noMs());
        vm.stopPrank();
    }

    function test_CreateEscrow_RevertsWithoutAllowanceOrBalance() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.createEscrow(address(usdc), alice, address(0), 1e6, DEADLINE, MEMO, _noMs());
    }

    // ---------- releaseEscrow ----------

    function test_Release_ByDepositor() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowReleased(id, alice, 40e6);
        vm.prank(funder);
        vault.releaseEscrow(id, 40e6);
        assertEq(usdc.balanceOf(alice), 40e6);
        assertEq(vault.escrowRemaining(id), 60e6);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Active));
    }

    function test_Release_ByArbiter() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(arbiter);
        vault.releaseEscrow(id, 100e6);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(vault.escrowRemaining(id), 0);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Completed));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Release_StillWorksAfterDeadline() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.warp(DEADLINE + 365 days);
        vm.prank(funder);
        vault.releaseEscrow(id, 100e6);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_Release_RevertsForBeneficiaryAndStranger() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(alice);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.releaseEscrow(id, 1e6);
        vm.prank(stranger);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.releaseEscrow(id, 1e6);
    }

    function test_Release_RevertsZeroAmount() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.releaseEscrow(id, 0);
    }

    function test_Release_RevertsExceedsRemaining() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseEscrow(id, 90e6);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.AmountExceedsRemaining.selector, 11e6, 10e6));
        vault.releaseEscrow(id, 11e6);
    }

    function test_Release_RevertsUnknownEscrow() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 7));
        vault.releaseEscrow(7, 1);
    }

    // ---------- refundEscrow ----------

    function test_Refund_DepositorBeforeDeadlineReverts() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, uint256(DEADLINE)));
        vault.refundEscrow(id, 1e6);
    }

    function test_Refund_DepositorAtDeadlineStillReverts() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.warp(DEADLINE);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, uint256(DEADLINE)));
        vault.refundEscrow(id, 1e6);
    }

    function test_Refund_DepositorAfterDeadlineNoArbiter() public {
        uint256 id = _escrow(address(0), 100e6, DEADLINE);
        vm.warp(uint256(DEADLINE) + 1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowRefunded(id, funder, 100e6);
        vm.prank(funder);
        vault.refundEscrow(id, 100e6);
        assertEq(usdc.balanceOf(funder), FUNDS);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Refunded));
    }

    function test_Refund_DepositorWithArbiterNeedsGrace() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        uint256 availableAfter = uint256(DEADLINE) + 7 days;

        vm.warp(uint256(DEADLINE) + 1); // past deadline but within grace
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, availableAfter));
        vault.refundEscrow(id, 1e6);

        vm.warp(availableAfter); // boundary, still blocked
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.RefundNotAvailable.selector, availableAfter));
        vault.refundEscrow(id, 1e6);

        vm.warp(availableAfter + 1);
        vm.prank(funder);
        vault.refundEscrow(id, 100e6);
        assertEq(usdc.balanceOf(funder), FUNDS);
    }

    function test_Refund_BeneficiaryAnytimeGoesToDepositor() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(alice);
        vault.refundEscrow(id, 30e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(funder), FUNDS - 70e6);
        assertEq(vault.escrowRemaining(id), 70e6);
    }

    function test_Refund_ArbiterAnytimeGoesToDepositor() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(arbiter);
        vault.refundEscrow(id, 100e6);
        assertEq(usdc.balanceOf(arbiter), 0);
        assertEq(usdc.balanceOf(funder), FUNDS);
    }

    function test_Refund_RevertsStranger() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.warp(DEADLINE + 365 days);
        vm.prank(stranger);
        vm.expectRevert(PayoutVault.Unauthorized.selector);
        vault.refundEscrow(id, 1e6);
    }

    function test_Refund_RevertsZeroAndExceeds() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.startPrank(alice);
        vm.expectRevert(PayoutVault.ZeroAmount.selector);
        vault.refundEscrow(id, 0);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.AmountExceedsRemaining.selector, 101e6, 100e6));
        vault.refundEscrow(id, 101e6);
        vm.stopPrank();
    }

    function test_Refund_RevertsUnknownEscrow() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 99));
        vault.refundEscrow(99, 1);
    }

    function test_Refund_AfterReleaseMixedStatusCompleted() public {
        uint256 id = _escrow(arbiter, 100e6, DEADLINE);
        vm.prank(funder);
        vault.releaseEscrow(id, 60e6);
        vm.prank(arbiter);
        vault.refundEscrow(id, 40e6);
        assertEq(vault.escrowRemaining(id), 0);
        assertEq(uint256(vault.escrowStatus(id)), uint256(PayoutVault.EscrowStatus.Completed));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Views_RevertUnknownEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 1));
        vault.escrowRemaining(1);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 1));
        vault.escrowStatus(1);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 0));
        vault.getEscrow(0);
    }
}
