//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "contracts/Token.sol";

contract Presaler is AccessControl {
    using Counters for Counters.Counter;
    Counters.Counter public presaleId;

    struct Presale {
        address creator;
        address tokenAddress;
        uint64 startTime;
        uint64 endTime;
        uint256 tokenPrice;
        uint256 tokenSupply;
        uint256 ethSupply;
    }

    event PresaleCreated(address creator);
    event TokenBought(address buyer, uint256 tokenAmount);
    event UniswapLiquidityAdded(uint256 ethAmount, uint256 tokenAmount);

    uint16 public usageFeeBPS;
    address payable public admin;
    address public uniswapRouterAddress;
    mapping(uint256 => Presale) public presales;
    mapping(address => uint256[]) public presalesByAddress;

    IUniswapV2Router02 public uniswap;

    constructor(
        address payable admin_,
        uint16 usageFeeBPS_,
        IUniswapV2Router02 uniswap_
    ) {
        require(usageFeeBPS_ <= 10000, "Usage fees must be less than 100%");
        usageFeeBPS = usageFeeBPS_;
        uniswap = IUniswapV2Router02(uniswap_);
        _setupRole(DEFAULT_ADMIN_ROLE, admin_);
        admin = admin_;
    }

    function changeUsageFee(uint16 usageFeeBPS_) external onlyAdmin {
        usageFeeBPS = usageFeeBPS_;
    }

    /**
    Prior to calling, ensure that an appropriate amount of presale tokens 
     have been transfered to the address of this contract
    @param tokenPrices token price is specified in the number of 
     base (smallest) units of the presale token bought with one wei
     lower number means more expensive
    */
    function startPresale(
        uint64[] memory startTimes,
        uint64[] memory endTimes,
        uint256[] memory tokenPrices,
        address[] memory tokenAddresses,
        uint256[] memory tokenSupplies
    ) public {
        uint256 listLen = startTimes.length;
        require(
            startTimes.length == listLen &&
                endTimes.length == listLen &&
                tokenPrices.length == listLen &&
                tokenAddresses.length == listLen &&
                tokenSupplies.length == listLen,
            "Parameter arrays must be the same length"
        );

        for (uint256 i = 0; i < listLen; i++) {
            require(
                endTimes[i] > startTimes[i],
                "End date must be after the start date"
            );
            require(tokenSupplies[i] > 0, "Token supply cannot be zero");
            Presale memory presale =
                Presale({
                    creator: msg.sender,
                    startTime: startTimes[i],
                    endTime: endTimes[i],
                    tokenPrice: tokenPrices[i],
                    tokenAddress: tokenAddresses[i],
                    tokenSupply: tokenSupplies[i],
                    ethSupply: 0
                });
            presales[presaleId.current()] = presale;
            presalesByAddress[msg.sender].push(presaleId.current());
            presaleId.increment();
        }
        emit PresaleCreated(msg.sender);
    }

    function myPresales() external view returns (uint256[] memory) {
        return presalesByAddress[msg.sender];
    }

    function buy(uint256 presaleId_) external payable {
        require(
            block.timestamp >= presales[presaleId_].startTime,
            "Presale hasn't started yet"
        );
        require(
            block.timestamp < presales[presaleId_].endTime,
            "Presale has ended"
        );
        uint256 tokenAmountMantissa = msg.value * presales[presaleId_].tokenPrice;
        require(
            tokenAmountMantissa <= presales[presaleId_].tokenSupply,
            "Insufficient token supply"
        );
        presales[presaleId_].tokenSupply -= tokenAmountMantissa;
        presales[presaleId_].ethSupply += msg.value;

        ERC20(presales[presaleId_].tokenAddress).transfer(
            msg.sender,
            tokenAmountMantissa
        );
        emit TokenBought(msg.sender, tokenAmountMantissa);
    }

    function withdraw(uint256 presaleId_) external {
        require(
            msg.sender == presales[presaleId_].creator,
            "Only presale creator can withdraw"
        );
        require(
            block.timestamp >= presales[presaleId_].endTime,
            "Presale hasn't ended yet"
        );
        ERC20(presales[presaleId_].tokenAddress).transfer(
            msg.sender,
            presales[presaleId_].tokenSupply
        );
    }

    function endPresale(uint256 presaleId_) external {
        require(
            block.timestamp >= presales[presaleId_].endTime,
            "Presale hasn't ended yet"
        );
        require(
            presales[presaleId_].ethSupply > 0,
            "No tokens were bought during presale"
        );
        // award admin their cut according to the usage fee
        uint256 adminFee =
            (presales[presaleId_].ethSupply * usageFeeBPS) / 10000;
        presales[presaleId_].ethSupply -= adminFee;
        admin.transfer(adminFee);
        // create a uniswap liquidity pool
        uint256 tokenBalanceMantissa =
            ERC20(presales[presaleId_].tokenAddress).balanceOf(address(this));
        uint256 tokenAmountMantissa =
            presales[presaleId_].ethSupply * presales[presaleId_].tokenPrice;
        require(
            tokenBalanceMantissa >= tokenAmountMantissa,
            "Insufficient tokens for a liquidity pool"
        );
        ERC20(presales[presaleId_].tokenAddress).approve(
            address(uniswap),
            tokenAmountMantissa
        );
        uniswap.addLiquidityETH{value: presales[presaleId_].ethSupply}(
            presales[presaleId_].tokenAddress,
            tokenAmountMantissa,
            tokenAmountMantissa,
            presales[presaleId_].ethSupply,
            address(this),
            block.timestamp + 1 days
        );
        emit UniswapLiquidityAdded(presales[presaleId_].ethSupply, tokenAmountMantissa);
    }

    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller must be the admin");
        _;
    }
}
