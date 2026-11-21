// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SurveyRedPacket
/// @notice 问卷拼手气红包：发布者把奖金锁进合约；填写者通过平台的公开质检规则后，
///         凭后端签发的领取凭证（EIP-712）领取"保底 + 拼手气"奖励。
///         token == address(0) 表示原生币（MON），否则为 ERC-20（例如 USDC）。
contract SurveyRedPacket {
    // ───────── 常量 ─────────
    uint256 public constant FEE_BPS = 500; // 平台服务费 5%，从每笔发放中扣除
    uint256 public constant BASE_BPS = 5000; // 奖池的 50% 平均分作保底
    uint256 public constant MAX_SLOTS = 1000;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TICKET_TYPEHASH =
        keccak256("ClaimTicket(uint256 surveyId,address respondent,bytes32 answerHash,bytes32 seed,uint64 expiry)");

    // ───────── 存储 ─────────
    struct Survey {
        address publisher;
        address token;
        uint128 totalPool;
        uint128 basePerSlot;
        uint128 luckyRemaining;
        uint128 bestAmount;
        uint32 maxSlots;
        uint32 claimed;
        uint64 deadline;
        bool closed;
        address best;
        bytes32 metaHash;
    }

    address public owner;
    address public signer;
    uint256 public surveyCount;
    mapping(uint256 => Survey) public surveys;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(bytes32 => bool) public usedAnswerHash;
    mapping(address => uint256) public accruedFee;

    uint256 private _lock = 1;

    // ───────── 事件 ─────────
    event SurveyCreated(
        uint256 indexed surveyId,
        address indexed publisher,
        address token,
        uint256 totalPool,
        uint32 maxSlots,
        uint64 deadline,
        bytes32 metaHash
    );
    event Claimed(
        uint256 indexed surveyId,
        address indexed respondent,
        uint32 index,
        uint256 base,
        uint256 lucky,
        uint256 net,
        uint256 fee
    );
    event BestChanged(uint256 indexed surveyId, address indexed respondent, uint256 grossAmount);
    event Refunded(uint256 indexed surveyId, address indexed publisher, uint256 amount);
    event SignerChanged(address signer);

    // ───────── 错误 ─────────
    error NotOwner();
    error NotPublisher();
    error BadParams();
    error BadValue();
    error SurveyClosed();
    error Expired();
    error Full();
    error AlreadyClaimed();
    error AnswerUsed();
    error BadSignature();
    error TransferFailed();
    error Reentrant();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address _signer) {
        owner = msg.sender;
        signer = _signer;
        emit SignerChanged(_signer);
    }

    // ───────── 发布者 ─────────

    /// @notice 创建问卷红包，并把奖池锁进合约
    function createSurvey(address token, uint128 totalPool, uint32 maxSlots, uint64 deadline, bytes32 metaHash)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        if (maxSlots == 0 || maxSlots > MAX_SLOTS || deadline <= block.timestamp) revert BadParams();
        // 每个名额至少 100 个最小单位，避免保底为 0
        if (totalPool < uint256(maxSlots) * 100) revert BadParams();

        if (token == address(0)) {
            if (msg.value != totalPool) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            if (!IERC20(token).transferFrom(msg.sender, address(this), totalPool)) revert TransferFailed();
        }

        uint128 base = uint128(uint256(totalPool) * BASE_BPS / 10_000 / maxSlots);
        id = ++surveyCount;
        Survey storage s = surveys[id];
        s.publisher = msg.sender;
        s.token = token;
        s.totalPool = totalPool;
        s.basePerSlot = base;
        s.luckyRemaining = totalPool - base * maxSlots;
        s.maxSlots = maxSlots;
        s.deadline = deadline;
        s.metaHash = metaHash;

        emit SurveyCreated(id, msg.sender, token, totalPool, maxSlots, deadline, metaHash);
    }

    /// @notice 发布者结束问卷，取回没发完的奖金（保底 + 拼手气剩余部分全额退回，不收服务费）
    function refund(uint256 id) external nonReentrant {
        Survey storage s = surveys[id];
        if (msg.sender != s.publisher) revert NotPublisher();
        if (s.closed) revert SurveyClosed();
        s.closed = true;
        uint256 amount = uint256(s.basePerSlot) * (s.maxSlots - s.claimed) + s.luckyRemaining;
        s.luckyRemaining = 0;
        _pay(s.token, s.publisher, amount);
        emit Refunded(id, s.publisher, amount);
    }

    // ───────── 领取 ─────────

    /// @notice 凭质检通过后签发的凭证领取。任何人都可以提交（通常由平台中继代付 gas），钱只会打给 respondent。
    function claim(
        uint256 id,
        address respondent,
        bytes32 answerHash,
        bytes32 seed,
        uint64 expiry,
        bytes calldata signature
    ) external nonReentrant returns (uint256 net) {
        Survey storage s = surveys[id];
        if (s.publisher == address(0) || s.closed) revert SurveyClosed();
        if (block.timestamp > s.deadline || block.timestamp > expiry) revert Expired();
        if (s.claimed >= s.maxSlots) revert Full();
        if (hasClaimed[id][respondent]) revert AlreadyClaimed();
        if (usedAnswerHash[answerHash]) revert AnswerUsed();

        bytes32 structHash = keccak256(abi.encode(TICKET_TYPEHASH, id, respondent, answerHash, seed, expiry));
        if (_recover(_hashTyped(structHash), signature) != signer) revert BadSignature();

        hasClaimed[id][respondent] = true;
        usedAnswerHash[answerHash] = true;

        // 拼手气：二倍均值法。剩余 n 个名额时，本次随机取 [1, 2 × 剩余均值)；最后一个人拿走全部剩余
        uint256 remainingSlots = s.maxSlots - s.claimed;
        uint256 lucky;
        if (remainingSlots == 1) {
            lucky = s.luckyRemaining;
        } else {
            uint256 cap = uint256(s.luckyRemaining) * 2 / remainingSlots;
            if (cap > 1) {
                uint256 r = uint256(keccak256(abi.encode(seed, block.prevrandao, id, s.claimed, respondent)));
                lucky = 1 + (r % (cap - 1));
            }
        }
        s.luckyRemaining -= uint128(lucky);
        s.claimed += 1;

        uint256 gross = uint256(s.basePerSlot) + lucky;
        uint256 fee = gross * FEE_BPS / 10_000;
        net = gross - fee;
        accruedFee[s.token] += fee;

        if (gross > s.bestAmount) {
            s.bestAmount = uint128(gross);
            s.best = respondent;
            emit BestChanged(id, respondent, gross);
        }

        emit Claimed(id, respondent, s.claimed, s.basePerSlot, lucky, net, fee);
        _pay(s.token, respondent, net);
    }

    // ───────── 平台 ─────────

    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
        emit SignerChanged(_signer);
    }

    function withdrawFees(address token, address to) external onlyOwner nonReentrant {
        uint256 amount = accruedFee[token];
        accruedFee[token] = 0;
        _pay(token, to, amount);
    }

    // ───────── 只读 ─────────

    function remainingPool(uint256 id) external view returns (uint256) {
        Survey storage s = surveys[id];
        if (s.closed) return 0;
        return uint256(s.basePerSlot) * (s.maxSlots - s.claimed) + s.luckyRemaining;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("SurveyRedPacket"), keccak256("1"), block.chainid, address(this))
        );
    }

    // ───────── 内部 ─────────

    function _hashTyped(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // 拒绝高位 s，防止签名延展
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        }
    }
}
