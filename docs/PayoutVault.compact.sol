pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts@5.6.1/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts@5.6.1/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.6.1/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts@5.6.1/utils/math/Math.sol";

contract PayoutVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EscrowStatus { Active, Completed, Refunded }
    enum Kind { Scheduled, Payroll, Vesting, InvestorLockup, Claim, Grant, TreasuryLockup, TimeLock, LPLockup }

    struct Escrow {
        IERC20 token;
        address depositor;
        address beneficiary;
        address arbiter;
        uint256 amount;
        uint256 released;
        uint256 refunded;
        uint64 deadline;
        uint64 createdAt;
        string memo;
        bool disputed;
        address disputedBy;
        uint64 disputedAt;
    }

    struct MilestoneInput {
        string title;
        uint256 amount;
    }

    struct Milestone {
        string title;
        uint256 amount;
        bool released;
    }

    struct Schedule {
        IERC20 token;
        address funder;
        address beneficiary;
        Kind kind;
        bool cancelable;
        bool cancelled;
        uint256 total;
        uint256 claimed;
        uint64 start;
        uint64 cliff;
        uint64 stepDuration;
        uint32 steps;
        uint64 createdAt;
        string memo;
    }

    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant MAX_MILESTONE_TITLE_BYTES = 80;
    uint256 public constant CLAIM_GRACE = 7 days;
    uint256 public constant ARBITER_GRACE = 7 days;
    uint256 public constant DISPUTE_WINDOW = 30 days;
    uint256 public constant MAX_DURATION = 20 * 365 days;
    uint256 public constant MAX_MEMO_BYTES = 140;
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public nextEscrowId = 1;
    uint256 public nextScheduleId = 1;

    mapping(uint256 => Milestone[]) private _milestones;
    mapping(uint256 => Escrow) private _escrows;
    mapping(uint256 => Schedule) private _schedules;
    mapping(address => uint256[]) private _escrowIds;
    mapping(address => uint256[]) private _scheduleIds;

    error ZeroAddress();
    error InvalidToken();
    error UnsupportedToken();
    error LockupMustBeNonCancelable();
    error InvalidBeneficiary();
    error InvalidArbiter();
    error ZeroAmount();
    error InvalidDeadline();
    error MemoTooLong();
    error UnknownEscrow(uint256 id);
    error UnknownSchedule(uint256 id);
    error Unauthorized();
    error RefundNotAvailable(uint256 availableAfter);
    error AmountExceedsRemaining(uint256 requested, uint256 remaining);
    error InvalidScheduleTiming();
    error InvalidBatch();
    error NothingReleasable();
    error ScheduleNotCancelable();
    error ScheduleAlreadyCancelled();

    error TooManyMilestones();
    error MilestoneTitleTooLong();
    error MilestoneMismatch();
    error UseMilestones();
    error UnknownMilestone();
    error MilestoneAlreadyReleased();
    error EscrowIsDisputed();
    error ClaimNotAvailable(uint256 claimOpensAt);
    error AlreadyDisputed();
    error NotDisputed();
    error NotExtendable();

    event MilestoneReleased(uint256 indexed id, uint256 indexed index, uint256 amount);
    event EscrowDisputed(uint256 indexed id, address indexed by);
    event EscrowDisputeCleared(uint256 indexed id, address indexed by);
    event ScheduleExtended(uint256 indexed id, uint32 extraSteps, uint256 extra, uint256 newTotal);

    event EscrowCreated(
        uint256 indexed id,
        address indexed depositor,
        address indexed beneficiary,
        address token,
        address arbiter,
        uint256 amount,
        uint64 deadline,
        string memo
    );
    event EscrowReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event EscrowRefunded(uint256 indexed id, address indexed depositor, uint256 amount);
    event ScheduleCreated(
        uint256 indexed id,
        address indexed funder,
        address indexed beneficiary,
        address token,
        Kind kind,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 stepDuration,
        uint32 steps
    );
    event ScheduleReleased(uint256 indexed id, address indexed beneficiary, address recipient, uint256 amount);
    event ScheduleCancelled(uint256 indexed id, uint256 refunded, uint256 frozenTotal);

    constructor() {}

    function createEscrow(
        address token,
        address beneficiary,
        address arbiter,
        uint256 amount,
        uint64 deadline,
        string calldata memo,
        MilestoneInput[] calldata milestones
    ) external nonReentrant returns (uint256 id) {
        _validateToken(token);
        _validateBeneficiary(beneficiary, token);
        if (beneficiary == msg.sender) revert InvalidBeneficiary();
        if (arbiter == msg.sender || arbiter == beneficiary) revert InvalidArbiter();
        if (amount == 0) revert ZeroAmount();
        if (uint256(deadline) <= block.timestamp) revert InvalidDeadline();
        _validateMemo(memo);

        id = nextEscrowId++;
        Escrow storage e = _escrows[id];
        e.token = IERC20(token);
        e.depositor = msg.sender;
        e.beneficiary = beneficiary;
        e.arbiter = arbiter;
        e.amount = amount;
        e.deadline = deadline;
        e.createdAt = uint64(block.timestamp);
        e.memo = memo;
        _storeMilestones(id, amount, milestones);
        _escrowIds[msg.sender].push(id);
        _escrowIds[beneficiary].push(id);
        if (arbiter != address(0)) _escrowIds[arbiter].push(id);

        emit EscrowCreated(id, msg.sender, beneficiary, token, arbiter, amount, deadline, memo);
        _pullExact(e.token, amount);
    }

    function releaseEscrow(uint256 id, uint256 amount) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.depositor && msg.sender != e.arbiter) revert Unauthorized();
        if (_milestones[id].length != 0) revert UseMilestones();
        _validateEscrowAmount(e, amount);
        e.released += amount;
        _clearArbiterDispute(id, e);
        emit EscrowReleased(id, e.beneficiary, amount);
        e.token.safeTransfer(e.beneficiary, amount);
    }

    function releaseMilestone(uint256 id, uint256 index) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.depositor && msg.sender != e.arbiter) revert Unauthorized();
        if (index >= _milestones[id].length) revert UnknownMilestone();
        Milestone storage m = _milestones[id][index];
        if (m.released) revert MilestoneAlreadyReleased();
        uint256 amount = m.amount;
        _validateEscrowAmount(e, amount);
        m.released = true;
        e.released += amount;
        _clearArbiterDispute(id, e);
        emit EscrowReleased(id, e.beneficiary, amount);
        emit MilestoneReleased(id, index, amount);
        e.token.safeTransfer(e.beneficiary, amount);
    }

    function claimEscrow(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.beneficiary) revert Unauthorized();
        uint256 remaining = e.amount - e.released - e.refunded;
        if (remaining == 0) revert NothingReleasable();
        if (e.disputed && block.timestamp < uint256(e.disputedAt) + DISPUTE_WINDOW) revert EscrowIsDisputed();
        uint256 claimOpensAt = _escrowClaimOpensAt(e);
        if (block.timestamp < claimOpensAt) revert ClaimNotAvailable(claimOpensAt);
        e.released += remaining;
        for (uint256 i; i < _milestones[id].length; ++i) {
            if (!_milestones[id][i].released) _milestones[id][i].released = true;
        }
        emit EscrowReleased(id, e.beneficiary, remaining);
        e.token.safeTransfer(e.beneficiary, remaining);
    }

    function dispute(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.depositor && msg.sender != e.beneficiary) revert Unauthorized();
        if (e.amount - e.released - e.refunded == 0) revert NothingReleasable();
        if (e.disputedAt != 0) revert AlreadyDisputed();
        e.disputedAt = uint64(block.timestamp);
        e.disputed = true;
        e.disputedBy = msg.sender;
        emit EscrowDisputed(id, msg.sender);
    }

    function withdrawDispute(uint256 id) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (!e.disputed) revert NotDisputed();
        if (msg.sender != e.disputedBy) revert Unauthorized();
        e.disputed = false;
        e.disputedBy = address(0);
        emit EscrowDisputeCleared(id, msg.sender);
    }

    function escrowClaimOpensAt(uint256 id) external view returns (uint256) {
        return _escrowClaimOpensAt(_getEscrow(id));
    }

    function getMilestones(uint256 id) external view returns (Milestone[] memory) {
        _getEscrow(id);
        return _milestones[id];
    }

    function refundEscrow(uint256 id, uint256 amount) external nonReentrant {
        Escrow storage e = _getEscrow(id);
        if (msg.sender != e.beneficiary && msg.sender != e.arbiter) {
            if (msg.sender != e.depositor) revert Unauthorized();
            uint256 availableAfter = uint256(e.deadline);
            if (e.arbiter != address(0)) availableAfter += ARBITER_GRACE;
            if (block.timestamp <= availableAfter) revert RefundNotAvailable(availableAfter);
        }
        _validateEscrowAmount(e, amount);
        e.refunded += amount;
        _clearArbiterDispute(id, e);
        emit EscrowRefunded(id, e.depositor, amount);
        e.token.safeTransfer(e.depositor, amount);
    }

    function escrowRemaining(uint256 id) external view returns (uint256) {
        Escrow storage e = _getEscrow(id);
        return e.amount - e.released - e.refunded;
    }

    function escrowStatus(uint256 id) external view returns (EscrowStatus) {
        Escrow storage e = _getEscrow(id);
        if (e.amount - e.released - e.refunded != 0) return EscrowStatus.Active;
        return e.released == 0 ? EscrowStatus.Refunded : EscrowStatus.Completed;
    }

    function createSchedule(
        address token,
        address beneficiary,
        Kind kind,
        bool cancelable,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 stepDuration,
        uint32 steps,
        string calldata memo
    ) external nonReentrant returns (uint256 id) {
        Schedule memory s;
        s.token = IERC20(token);
        s.funder = msg.sender;
        s.beneficiary = beneficiary;
        s.kind = kind;
        s.cancelable = cancelable;
        s.total = total;
        s.start = start;
        s.cliff = cliff;
        s.stepDuration = stepDuration;
        s.steps = steps;
        s.createdAt = uint64(block.timestamp);
        s.memo = memo;
        _validateSchedule(s);
        id = _storeSchedule(s);
        _pullExact(s.token, s.total);
    }

    function createPayrollBatch(
        address token,
        address[] calldata beneficiaries,
        uint256[] calldata totals,
        bool cancelable,
        uint64 start,
        uint64 stepDuration,
        uint32 steps,
        string calldata memo
    ) external nonReentrant returns (uint256[] memory ids) {
        if (
            beneficiaries.length == 0 || beneficiaries.length > MAX_BATCH_SIZE
                || beneficiaries.length != totals.length
        ) revert InvalidBatch();

        Schedule memory s;
        s.token = IERC20(token);
        s.funder = msg.sender;
        s.kind = Kind.Payroll;
        s.cancelable = cancelable;
        s.start = start;
        s.stepDuration = stepDuration;
        s.steps = steps;
        s.createdAt = uint64(block.timestamp);
        s.memo = memo;
        ids = new uint256[](beneficiaries.length);
        uint256 funding;
        for (uint256 i; i < beneficiaries.length; ++i) {
            s.beneficiary = beneficiaries[i];
            s.total = totals[i];
            _validateSchedule(s);
            funding += s.total;
            ids[i] = _storeSchedule(s);
        }
        _pullExact(s.token, funding);
    }

    function extendSchedule(uint256 id, uint32 extraSteps) external nonReentrant {
        Schedule storage s = _getSchedule(id);
        if (msg.sender != s.funder) revert Unauthorized();
        if (s.kind != Kind.Payroll) revert NotExtendable();
        if (s.cancelled) revert ScheduleAlreadyCancelled();
        if (extraSteps == 0) revert ZeroAmount();
        if (s.total % s.steps != 0) revert NotExtendable();
        uint256 perStep = s.total / s.steps;
        uint256 extra = perStep * uint256(extraSteps);
        uint256 newSteps = uint256(s.steps) + uint256(extraSteps);
        if (
            newSteps > type(uint32).max || uint256(s.stepDuration) * newSteps > MAX_DURATION
        ) revert InvalidScheduleTiming();
        s.total += extra;
        s.steps = uint32(newSteps);
        emit ScheduleExtended(id, extraSteps, extra, s.total);
        _pullExact(s.token, extra);
    }

    function release(uint256 id) external nonReentrant {
        Schedule storage s = _getSchedule(id);
        uint256 amount = _unlocked(s, block.timestamp) - s.claimed;
        if (amount == 0) revert NothingReleasable();
        s.claimed += amount;
        emit ScheduleReleased(id, s.beneficiary, s.beneficiary, amount);
        s.token.safeTransfer(s.beneficiary, amount);
    }

    function releaseTo(uint256 id, address recipient) external nonReentrant {
        Schedule storage s = _getSchedule(id);
        if (msg.sender != s.beneficiary) revert Unauthorized();
        if (
            uint160(recipient) <= 0xFFFF || recipient == address(this) || recipient == address(s.token)
        ) revert InvalidBeneficiary();
        uint256 amount = _unlocked(s, block.timestamp) - s.claimed;
        if (amount == 0) revert NothingReleasable();
        s.claimed += amount;
        emit ScheduleReleased(id, s.beneficiary, recipient, amount);
        s.token.safeTransfer(recipient, amount);
    }

    function cancel(uint256 id) external nonReentrant {
        Schedule storage s = _getSchedule(id);
        if (msg.sender != s.funder) revert Unauthorized();
        if (!s.cancelable) revert ScheduleNotCancelable();
        if (s.cancelled) revert ScheduleAlreadyCancelled();
        uint256 frozenTotal = _unlocked(s, block.timestamp);
        uint256 refund = s.total - frozenTotal;
        s.cancelled = true;
        s.total = frozenTotal;
        emit ScheduleCancelled(id, refund, frozenTotal);
        if (refund != 0) s.token.safeTransfer(s.funder, refund);
    }

    function unlockedAmount(uint256 id) external view returns (uint256) {
        return _unlocked(_getSchedule(id), block.timestamp);
    }

    function releasable(uint256 id) external view returns (uint256) {
        Schedule storage s = _getSchedule(id);
        return _unlocked(s, block.timestamp) - s.claimed;
    }

    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return _getEscrow(id);
    }

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return _getSchedule(id);
    }

    function escrowIdsOf(address account) external view returns (uint256[] memory) {
        return _escrowIds[account];
    }

    function scheduleIdsOf(address account) external view returns (uint256[] memory) {
        return _scheduleIds[account];
    }

    function _getEscrow(uint256 id) private view returns (Escrow storage e) {
        e = _escrows[id];
        if (e.depositor == address(0)) revert UnknownEscrow(id);
    }

    function _getSchedule(uint256 id) private view returns (Schedule storage s) {
        s = _schedules[id];
        if (s.funder == address(0)) revert UnknownSchedule(id);
    }

    function _validateToken(address token) private view {
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
    }

    function _pullExact(IERC20 token, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert UnsupportedToken();
    }

    function _validateBeneficiary(address beneficiary, address token) private view {
        if (
            uint160(beneficiary) <= 0xFFFF
                || beneficiary == address(this) || beneficiary == token
        ) revert InvalidBeneficiary();
    }

    function _validateMemo(string memory memo) private pure {
        if (bytes(memo).length > MAX_MEMO_BYTES) revert MemoTooLong();
    }

    function _storeMilestones(uint256 id, uint256 amount, MilestoneInput[] calldata milestones) private {
        if (milestones.length > MAX_MILESTONES) revert TooManyMilestones();
        if (milestones.length == 0) return;
        uint256 sum;
        for (uint256 i; i < milestones.length; ++i) {
            MilestoneInput calldata m = milestones[i];
            if (m.amount == 0) revert ZeroAmount();
            if (bytes(m.title).length > MAX_MILESTONE_TITLE_BYTES) revert MilestoneTitleTooLong();
            if (m.amount > amount - sum) revert MilestoneMismatch();
            sum += m.amount;
            _milestones[id].push(Milestone({title: m.title, amount: m.amount, released: false}));
        }
        if (sum != amount) revert MilestoneMismatch();
    }

    function _escrowClaimOpensAt(Escrow storage e) private view returns (uint256) {
        uint256 claimOpensAt = uint256(e.deadline) + CLAIM_GRACE;
        if (e.arbiter != address(0)) claimOpensAt += ARBITER_GRACE;
        return claimOpensAt;
    }

    function _clearArbiterDispute(uint256 id, Escrow storage e) private {
        if (e.disputed && msg.sender == e.arbiter) {
            e.disputed = false;
            e.disputedBy = address(0);
            emit EscrowDisputeCleared(id, msg.sender);
        }
    }

    function _validateEscrowAmount(Escrow storage e, uint256 amount) private view {
        if (amount == 0) revert ZeroAmount();
        uint256 remaining = e.amount - e.released - e.refunded;
        if (amount > remaining) revert AmountExceedsRemaining(amount, remaining);
    }

    function _validateSchedule(Schedule memory s) private view {
        _validateToken(address(s.token));
        _validateBeneficiary(s.beneficiary, address(s.token));
        if (
            s.cancelable && (
                s.kind == Kind.InvestorLockup || s.kind == Kind.TreasuryLockup
                    || s.kind == Kind.TimeLock || s.kind == Kind.LPLockup
            )
        ) revert LockupMustBeNonCancelable();
        if (s.total == 0) revert ZeroAmount();
        _validateMemo(s.memo);
        uint256 duration = uint256(s.stepDuration) * uint256(s.steps);
        if (
            s.steps == 0 || s.stepDuration == 0 || duration > MAX_DURATION
                || uint256(s.cliff) > duration || block.timestamp > uint256(s.start) + 1 days
        ) revert InvalidScheduleTiming();
    }

    function _storeSchedule(Schedule memory s) private returns (uint256 id) {
        id = nextScheduleId++;
        _schedules[id] = s;
        _scheduleIds[s.funder].push(id);
        if (s.beneficiary != s.funder) _scheduleIds[s.beneficiary].push(id);
        _emitScheduleCreated(id);
    }

    function _emitScheduleCreated(uint256 id) private {
        Schedule storage s = _schedules[id];
        emit ScheduleCreated(
            id, s.funder, s.beneficiary, address(s.token), s.kind, s.total,
            s.start, s.cliff, s.stepDuration, s.steps
        );
    }

    function _unlocked(Schedule storage s, uint256 timestamp) private view returns (uint256) {
        if (s.cancelled) return s.total;
        if (timestamp < uint256(s.start) + uint256(s.cliff)) return 0;
        uint256 elapsed = timestamp - uint256(s.start);
        if (elapsed >= uint256(s.stepDuration) * uint256(s.steps)) return s.total;
        uint256 done = elapsed / uint256(s.stepDuration);
        return Math.mulDiv(s.total, done, uint256(s.steps));
    }
}
