// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SurveyRedPacket} from "../src/SurveyRedPacket.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

contract SurveyRedPacketTest is Test {
    SurveyRedPacket c;
    uint256 signerPk = 0xA11CE;
    address signerAddr;
    address publisher = address(0xBEEF);
    address relayer = address(0xCAFE);

    function setUp() public {
        signerAddr = vm.addr(signerPk);
        c = new SurveyRedPacket(signerAddr);
        vm.deal(publisher, 1000 ether);
    }

    function _create(uint128 pool, uint32 slots) internal returns (uint256) {
        vm.prank(publisher);
        return c.createSurvey{value: pool}(address(0), pool, slots, uint64(block.timestamp + 3600), keccak256("meta"));
    }

    function _sig(uint256 id, address who, bytes32 ah, bytes32 seed, uint64 exp) internal view returns (bytes memory) {
        bytes32 sh = keccak256(abi.encode(c.TICKET_TYPEHASH(), id, who, ah, seed, exp));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", c.domainSeparator(), sh));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, d);
        return abi.encodePacked(r, s, v);
    }

    function _claimExpectRevert(uint256 id, address who, uint256 n, bytes4 sel) internal {
        bytes32 ah = keccak256(abi.encode(id, who, n));
        bytes32 seed = keccak256(abi.encode("seed", n));
        uint64 exp = uint64(block.timestamp + 600);
        bytes memory sig = _sig(id, who, ah, seed, exp);
        vm.prank(relayer);
        vm.expectRevert(sel);
        c.claim(id, who, ah, seed, exp, sig);
    }

    function _claim(uint256 id, address who, uint256 n) internal returns (uint256) {
        bytes32 ah = keccak256(abi.encode(id, who, n));
        bytes32 seed = keccak256(abi.encode("seed", n));
        uint64 exp = uint64(block.timestamp + 600);
        bytes memory sig = _sig(id, who, ah, seed, exp);
        vm.prank(relayer);
        return c.claim(id, who, ah, seed, exp, sig);
    }

    function test_CreateLocksPool() public {
        uint256 id = _create(5 ether, 20);
        (address pub,, uint128 total, uint128 base, uint128 lucky,,,,,,,) = c.surveys(id);
        assertEq(pub, publisher);
        assertEq(total, 5 ether);
        assertEq(base, 0.125 ether);
        assertEq(lucky, 2.5 ether);
        assertEq(address(c).balance, 5 ether);
    }

    function test_ClaimPaysRespondentNotRelayer() public {
        uint256 id = _create(5 ether, 20);
        address who = address(0x1001);
        uint256 net = _claim(id, who, 1);
        assertEq(who.balance, net);
        assertEq(relayer.balance, 0);
        assertGt(net, 0.125 ether * 95 / 100);
    }

    function test_AllClaimsConserveFunds() public {
        uint128 pool = 5 ether;
        uint256 id = _create(pool, 20);
        uint256 paid;
        for (uint256 i = 0; i < 20; i++) {
            paid += _claim(id, address(uint160(0x2000 + i)), i);
        }
        assertEq(paid + c.accruedFee(address(0)), pool);
        assertEq(c.remainingPool(id), 0);
        assertEq(address(c).balance, c.accruedFee(address(0)));
    }

    function testFuzz_PartialClaimsThenRefundConserve(uint8 n, uint128 pool) public {
        uint32 slots = 20;
        pool = uint128(bound(pool, 1e15, 100 ether));
        n = uint8(bound(n, 0, slots));
        uint256 id = _create(pool, slots);
        uint256 paid;
        for (uint256 i = 0; i < n; i++) {
            paid += _claim(id, address(uint160(0x3000 + i)), i);
        }
        uint256 before = publisher.balance;
        vm.prank(publisher);
        c.refund(id);
        uint256 refunded = publisher.balance - before;
        assertEq(paid + c.accruedFee(address(0)) + refunded, pool);
    }

    function test_RevertDoubleClaim() public {
        uint256 id = _create(5 ether, 20);
        address who = address(0x5101);
        _claim(id, who, 1);
        _claimExpectRevert(id, who, 2, SurveyRedPacket.AlreadyClaimed.selector);
    }

    function test_RevertBadSigner() public {
        uint256 id = _create(5 ether, 20);
        bytes32 ah = keccak256("a");
        uint64 exp = uint64(block.timestamp + 600);
        bytes32 sh = keccak256(abi.encode(c.TICKET_TYPEHASH(), id, address(0x1), ah, bytes32(0), exp));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", c.domainSeparator(), sh));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, d);
        vm.expectRevert(SurveyRedPacket.BadSignature.selector);
        c.claim(id, address(0x1), ah, bytes32(0), exp, abi.encodePacked(r, s, v));
    }

    function test_RevertTamperedRespondent() public {
        uint256 id = _create(5 ether, 20);
        bytes32 ah = keccak256("a");
        uint64 exp = uint64(block.timestamp + 600);
        bytes memory sig = _sig(id, address(0x1), ah, bytes32(0), exp);
        vm.expectRevert(SurveyRedPacket.BadSignature.selector);
        c.claim(id, address(0x2), ah, bytes32(0), exp, sig);
    }

    function test_RevertWhenFull() public {
        uint256 id = _create(1 ether, 2);
        _claim(id, address(0x5011), 1);
        _claim(id, address(0x5012), 2);
        _claimExpectRevert(id, address(0x5013), 3, SurveyRedPacket.Full.selector);
    }

    function test_RevertExpiredTicket() public {
        uint256 id = _create(1 ether, 2);
        bytes32 ah = keccak256("a");
        uint64 exp = uint64(block.timestamp + 10);
        bytes memory sig = _sig(id, address(0x1), ah, bytes32(0), exp);
        vm.warp(block.timestamp + 11);
        vm.expectRevert(SurveyRedPacket.Expired.selector);
        c.claim(id, address(0x1), ah, bytes32(0), exp, sig);
    }

    function test_RefundOnlyPublisherAndCloses() public {
        uint256 id = _create(1 ether, 2);
        vm.expectRevert(SurveyRedPacket.NotPublisher.selector);
        c.refund(id);
        vm.prank(publisher);
        c.refund(id);
        _claimExpectRevert(id, address(0x5001), 1, SurveyRedPacket.SurveyClosed.selector);
    }

    function test_ERC20Flow() public {
        MockToken t = new MockToken();
        t.mint(publisher, 10e6);
        vm.startPrank(publisher);
        t.approve(address(c), 5e6);
        uint256 id = c.createSurvey(address(t), 5e6, 20, uint64(block.timestamp + 3600), bytes32(0));
        vm.stopPrank();
        uint256 paid;
        for (uint256 i = 0; i < 20; i++) {
            paid += _claim(id, address(uint160(0x4000 + i)), i);
        }
        assertEq(paid + c.accruedFee(address(t)), 5e6);
    }

    function test_WithdrawFeesOnlyOwner() public {
        uint256 id = _create(1 ether, 1);
        _claim(id, address(0x5201), 1);
        vm.prank(address(0xBAD));
        vm.expectRevert(SurveyRedPacket.NotOwner.selector);
        c.withdrawFees(address(0), address(0xBAD));
        uint256 fee = c.accruedFee(address(0));
        c.withdrawFees(address(0), address(0x99));
        assertEq(address(0x99).balance, fee);
    }
}
