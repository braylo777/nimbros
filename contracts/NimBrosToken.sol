// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// The NimBros launch token. Fixed rules, written into the contract itself so a buyer can read them on chain:
///  - the whole supply is minted once, in the constructor, to the launcher
///  - there is NO owner, NO mint function, NO burn or pause, NO blacklist, NO fee on transfer, NO upgrade path
///  - name, symbol and decimals are set once and can never change
/// It is a plain ERC-20. Nothing else is in it.
contract NimBrosToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 supplyWhole) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        uint256 total = supplyWhole * (10 ** uint256(decimals_));
        totalSupply = total;
        balanceOf[msg.sender] = total;
        emit Transfer(address(0), msg.sender, total);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            unchecked { allowance[from][msg.sender] = allowed - value; }
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        require(to != address(0), "zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "balance");
        unchecked { balanceOf[from] = bal - value; }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
