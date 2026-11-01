// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Drives bounded vault actions across two tokens. The handler is the funder/depositor
///      and is also one of the possible beneficiaries (self-locks).
contract PayoutVaultHandler is Test {
    PayoutVault public vault;
    MockERC20[2] public tokens;
    address[5] public actors;

    constructor(PayoutVault v, MockERC20 t0, MockERC20 t1) {
        vault = v;
        tokens[0] = t0;
        tokens[1] = t1;
        actors[0] = address(0xA11CE);
        actors[1] = address(0xB0B00);
        actors[2] = address(0xCA201);
        actors[3] = address(0xD00D0);
        actors[4] = address(this);
        for (uint256 i; i < 2; ++i) {
            tokens[i].mint(address(this), type(uint128).max);
            tokens[i].approve(address(v), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 5];
    }

    function _token(uint256 seed) internal view returns (address) {
        return address(tokens[seed % 2]);
    }

    function warp(uint256 dt) external {
        skip(bound(dt, 0, 200 days));
    }

    /// @dev Builds `n` milestones (1..4) whose amounts sum exactly to `amount` (amount >= n).
    function _milestones(uint256 amount, uint256 n, uint256 seed)
        internal
        pure
        returns (PayoutVault.MilestoneInput[] memory ms)
    {
        ms = new PayoutVault.MilestoneInput[](n);
        uint256 left = amount;
        for (uint256 i; i < n; ++i) {
            uint256 part = i == n - 1 ? left : bound(uint256(keccak256(abi.encode(seed, i))), 1, left - (n - 1 - i));
            ms[i] = PayoutVault.MilestoneInput("m", part);
            left -= part;
        }
    }

    function createEscrow(uint256 tok, uint256 ben, uint256 arb, uint256 amount, uint256 dl, uint256 msSeed)
        external
    {
        address b = _actor(ben);
        if (b == address(this)) b = actors[0]; // escrow beneficiary may not be the depositor
        address a = arb % 3 == 0 ? address(0) : _actor(arb + 1);
        if (a == b || a == address(this)) a = address(0);
        amount = bound(amount, 4, 1e12);
        dl = bound(dl, 1, 60 days);
        // 0 => no milestones, else 1..4 milestones
        uint256 n = msSeed % 5;
        PayoutVault.MilestoneInput[] memory ms = n == 0 ? new PayoutVault.MilestoneInput[](0) : _milestones(amount, n, msSeed);
        vault.createEscrow(_token(tok), b, a, amount, uint64(block.timestamp + dl), "e", ms);
    }

    function releaseEscrow(uint256 idSeed, uint256 amount, bool asArbiter) external {
        uint256 n = vault.nextEscrowId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 rem = vault.escrowRemaining(id);
        if (rem == 0) return;
        amount = bound(amount, 1, rem);
        address arb = vault.getEscrow(id).arbiter;
        if (asArbiter && arb != address(0)) vm.prank(arb);
        // reverts with UseMilestones on milestone escrows
        try vault.releaseEscrow(id, amount) {} catch {}
    }

    function releaseMilestone(uint256 idSeed, uint256 idx, bool asArbiter) external {
        uint256 n = vault.nextEscrowId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 len = vault.getMilestones(id).length;
        if (len == 0) return;
        idx = bound(idx, 0, len - 1);
        address arb = vault.getEscrow(id).arbiter;
        if (asArbiter && arb != address(0)) vm.prank(arb);
        // may legitimately revert: already released / exceeds remaining after refunds
        try vault.releaseMilestone(id, idx) {} catch {}
    }

    function claimEscrow(uint256 idSeed) external {
        uint256 n = vault.nextEscrowId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        vm.prank(vault.getEscrow(id).beneficiary);
        // may legitimately revert: window not open / disputed / nothing left
        try vault.claimEscrow(id) {} catch {}
    }

    function dispute(uint256 idSeed, bool byBeneficiary) external {
        uint256 n = vault.nextEscrowId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        if (byBeneficiary) vm.prank(vault.getEscrow(id).beneficiary);
        try vault.dispute(id) {} catch {}
    }

    function withdrawDispute(uint256 idSeed) external {
        uint256 n = vault.nextEscrowId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        address by = vault.getEscrow(id).disputedBy;
        if (by == address(0)) return;
        vm.prank(by);
        try vault.withdrawDispute(id) {} catch {}
    }

    function extendSchedule(uint256 idSeed, uint256 extra) external {
        uint256 n = vault.nextScheduleId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        extra = bound(extra, 1, 50);
        // handler is always the funder; reverts for non-payroll / cancelled / indivisible / too long
        try vault.extendSchedule(id, uint32(extra)) {} catch {}
    }

    function refundEscrow(uint256 idSeed, uint256 amount, uint256 who) external {
        uint256 n = vault.nextEscrowId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 rem = vault.escrowRemaining(id);
        if (rem == 0) return;
        amount = bound(amount, 1, rem);
        PayoutVault.Escrow memory e = vault.getEscrow(id);
        if (who % 3 == 0) vm.prank(e.beneficiary);
        else if (who % 3 == 1 && e.arbiter != address(0)) vm.prank(e.arbiter);
        // else: depositor (this) — may legitimately revert before the window opens
        try vault.refundEscrow(id, amount) {} catch {}
    }

    function createSchedule(
        uint256 tok,
        uint256 ben,
        uint256 kindSeed,
        uint256 total,
        uint256 cliff,
        uint256 stepDur,
        uint256 steps,
        bool cancelable
    ) external {
        total = bound(total, 1, 1e12);
        stepDur = bound(stepDur, 1, 30 days);
        steps = bound(steps, 1, 50);
        cliff = bound(cliff, 0, stepDur * steps);
        PayoutVault.Kind k = PayoutVault.Kind(kindSeed % 9);
        if (
            k == PayoutVault.Kind.InvestorLockup || k == PayoutVault.Kind.TreasuryLockup
                || k == PayoutVault.Kind.TimeLock || k == PayoutVault.Kind.LPLockup
        ) cancelable = false;
        vault.createSchedule(
            _token(tok), _actor(ben), k, cancelable, total, uint64(block.timestamp), uint64(cliff),
            uint64(stepDur), uint32(steps), "s"
        );
    }

    function createPayroll(uint256 tok, uint256 seed, uint256 n, uint256 stepDur, uint256 steps) external {
        n = bound(n, 1, 5);
        stepDur = bound(stepDur, 1, 30 days);
        steps = bound(steps, 1, 50);
        address[] memory bens = new address[](n);
        uint256[] memory totals = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            bens[i] = _actor(seed + i);
            totals[i] = bound(uint256(keccak256(abi.encode(seed, i))), 1, 1e12);
            // half the batches use totals divisible by steps so they stay extendable
            if (seed % 4 < 2) totals[i] = bound(totals[i], 1, 1e12 / steps) * steps;
        }
        vault.createPayrollBatch(
            _token(tok), bens, totals, seed % 2 == 0, uint64(block.timestamp), uint64(stepDur), uint32(steps), "p"
        );
    }

    function releaseSchedule(uint256 idSeed) external {
        uint256 n = vault.nextScheduleId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        if (vault.releasable(id) == 0) return;
        vault.release(id);
    }

    function releaseScheduleTo(uint256 idSeed, uint256 rcpt) external {
        uint256 n = vault.nextScheduleId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        if (vault.releasable(id) == 0) return;
        vm.prank(vault.getSchedule(id).beneficiary);
        vault.releaseTo(id, address(uint160(0x70000 + (rcpt % 5))));
    }

    function cancelSchedule(uint256 idSeed) external {
        uint256 n = vault.nextScheduleId() - 1;
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        PayoutVault.Schedule memory s = vault.getSchedule(id);
        if (!s.cancelable || s.cancelled) return;
        vault.cancel(id);
    }
}

contract PayoutVaultInvariantTest is Test {
    PayoutVault internal vault;
    MockERC20 internal usdc;
    MockERC20 internal dai;
    PayoutVaultHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        dai = new MockERC20("Mock DAI", "mDAI", 18);
        vault = new PayoutVault();
        handler = new PayoutVaultHandler(vault, usdc, dai);
        targetContract(address(handler));
    }

    /// Σ escrow remaining + Σ (schedule total − claimed) for one token
    function _owed(address token) internal view returns (uint256 owed) {
        uint256 ne = vault.nextEscrowId();
        for (uint256 i = 1; i < ne; ++i) {
            PayoutVault.Escrow memory e = vault.getEscrow(i);
            if (address(e.token) == token) owed += e.amount - e.released - e.refunded;
        }
        uint256 ns = vault.nextScheduleId();
        for (uint256 i = 1; i < ns; ++i) {
            PayoutVault.Schedule memory s = vault.getSchedule(i);
            if (address(s.token) == token) owed += s.total - s.claimed;
        }
    }

    /// Per token: vault balance == escrow remaining + schedule total − claimed.
    function invariant_PerTokenVaultBalanceEqualsOutstandingObligations() public view {
        assertEq(usdc.balanceOf(address(vault)), _owed(address(usdc)));
        assertEq(dai.balanceOf(address(vault)), _owed(address(dai)));
    }

    /// claimed never exceeds (frozen or live) total, and unlocked never exceeds total
    function invariant_ClaimedNeverExceedsTotal() public view {
        uint256 ns = vault.nextScheduleId();
        for (uint256 i = 1; i < ns; ++i) {
            PayoutVault.Schedule memory s = vault.getSchedule(i);
            assertLe(s.claimed, s.total);
            assertLe(vault.unlockedAmount(i), s.total);
        }
    }

    function invariant_EscrowAllocationsNeverExceedAmount() public view {
        uint256 ne = vault.nextEscrowId();
        for (uint256 i = 1; i < ne; ++i) {
            PayoutVault.Escrow memory e = vault.getEscrow(i);
            assertLe(e.released + e.refunded, e.amount);
        }
    }

    /// claimed never exceeds what is unlocked (also after payroll extensions)
    function invariant_ClaimedNeverExceedsUnlocked() public view {
        uint256 ns = vault.nextScheduleId();
        for (uint256 i = 1; i < ns; ++i) {
            assertLe(vault.getSchedule(i).claimed, vault.unlockedAmount(i));
        }
    }

    /// Milestone amounts always sum to the escrow amount, and the escrow's remaining balance
    /// never exceeds the sum of milestones not yet marked released.
    function invariant_MilestonesConsistentWithEscrow() public view {
        uint256 ne = vault.nextEscrowId();
        for (uint256 i = 1; i < ne; ++i) {
            PayoutVault.Milestone[] memory ms = vault.getMilestones(i);
            if (ms.length == 0) continue;
            PayoutVault.Escrow memory e = vault.getEscrow(i);
            uint256 sum;
            uint256 unreleased;
            uint256 releasedSum;
            for (uint256 j; j < ms.length; ++j) {
                sum += ms[j].amount;
                if (ms[j].released) releasedSum += ms[j].amount;
                else unreleased += ms[j].amount;
            }
            assertEq(sum, e.amount);
            assertLe(e.amount - e.released - e.refunded, unreleased);
            assertLe(releasedSum, e.released + e.refunded);
        }
    }

    /// An active dispute always records a time and an opener who is a depositor/beneficiary.
    function invariant_DisputeStateIsCoherent() public view {
        uint256 ne = vault.nextEscrowId();
        for (uint256 i = 1; i < ne; ++i) {
            PayoutVault.Escrow memory e = vault.getEscrow(i);
            if (e.disputed) {
                assertGt(e.disputedAt, 0);
                assertTrue(e.disputedBy == e.depositor || e.disputedBy == e.beneficiary);
            } else {
                assertEq(e.disputedBy, address(0));
            }
        }
    }

    /// Every item's token is one of the two supported mocks.
    function invariant_ItemTokensAreKnown() public view {
        uint256 ne = vault.nextEscrowId();
        for (uint256 i = 1; i < ne; ++i) {
            address t = address(vault.getEscrow(i).token);
            assertTrue(t == address(usdc) || t == address(dai));
        }
        uint256 ns = vault.nextScheduleId();
        for (uint256 i = 1; i < ns; ++i) {
            address t = address(vault.getSchedule(i).token);
            assertTrue(t == address(usdc) || t == address(dai));
        }
    }
}
