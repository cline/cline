export const sampleSolidity = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ITestInterface {
    function interfaceFunction(uint256 value) external returns (bool);
    event InterfaceEvent(address indexed sender, uint256 value);
    error InterfaceError(string message);
}

library MathLib {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }
    
    function subtract(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "Underflow");
        return a - b;
    }
}

contract TestContract is ITestInterface {
    using MathLib for uint256;
    
    struct UserInfo {
        address userAddress;
        uint256 balance;
        mapping(bytes32 => bool) permissions;
        uint256 lastUpdate;
    }
    
    enum UserRole {
        None,
        Basic,
        Admin,
        SuperAdmin
    }
    
    uint256 private immutable totalSupply;
    mapping(address => UserInfo) private users;
    UserRole[] private roles;
    
    event Transfer(
        address indexed from,
        address indexed to,
        uint256 amount
    );
    
    error InsufficientBalance(
        address user,
        uint256 available,
        uint256 required
    );
    
    modifier onlyAdmin() {
        require(
            users[msg.sender].permissions["ADMIN_ROLE"],
            "Admin only"
        );
        _;
    }
    
    constructor(uint256 _initialSupply) {
        totalSupply = _initialSupply;
        users[msg.sender].userAddress = msg.sender;
        users[msg.sender].balance = _initialSupply;
        users[msg.sender].permissions["ADMIN_ROLE"] = true;
    }
    
    function transfer(
        address to,
        uint256 amount
    ) external returns (bool) {
        if (users[msg.sender].balance < amount) {
            revert InsufficientBalance({
                user: msg.sender,
                available: users[msg.sender].balance,
                required: amount
            });
        }
        
        users[msg.sender].balance = users[msg.sender].balance.subtract(amount);
        users[to].balance = users[to].balance.add(amount);
        
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function interfaceFunction(
        uint256 value
    ) external override returns (bool) {
        return value > 0;
    }
    
    fallback() external payable {
        revert("Fallback not allowed");
    }
    
    receive() external payable {
        revert("Direct deposits not allowed");
    }
}`
