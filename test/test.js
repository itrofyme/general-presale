const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { abi: routerAbi } = require("@uniswap/v2-periphery/build/IUniswapV2Router02.json");

let token, presaler;
let mockRouterContract;
let owner, presalerAdmin, account2, minter, presaleCreator, buyer, account6;

const getOffsetTimestamp = (offset) => {
  return parseInt(Date.now() / 1000) + offset;
} 

describe("Setup", function() {
  it("Populating addresses", async function() {
    [owner, presalerAdmin, account2, minter, presaleCreator, buyer, account6] = await ethers.getSigners();
  });

  it("Deploying mock uniswap contract", async function() {
    mockRouterContract = await waffle.deployMockContract(owner, routerAbi);
    await mockRouterContract.mock.addLiquidityETH.returns(0, 0, 0);
    await mockRouterContract.addLiquidityETH(owner.address, 1, 1, 1, owner.address, 1);
  });

  it("Deploy Token contract", async function() {
    const Token = await ethers.getContractFactory("Token");
    token = await Token.deploy();
    await token.deployed();
  });

  it("Deploy Presaler contract", async function() {
    const Presaler = await ethers.getContractFactory("Presaler");
    presaler = await Presaler.deploy(presalerAdmin.address, ethers.BigNumber.from(100), mockRouterContract.address);
    await presaler.deployed();
  });
});

describe("Token", function() {
  it("Should mint when called by owner", async function() {
    const tx = await token.connect(owner).mint(account2.address, ethers.utils.parseEther("1").toString());
    await tx.wait();
  });

  it("Should not mint when called by non minter", async function() {
    await expect(
      token.connect(account2).mint(account2.address, ethers.utils.parseEther("1").toString())
    ).to.be.revertedWith('Caller must be a minter');
  });

  it("Owner should be able to add a minter", async function() {
    const tx = await token.connect(owner).addMinter(minter.address);
    await tx.wait();
  });

  it("Should mint when called by minter", async function() {
    const tx = await token.connect(minter).mint(minter.address, ethers.utils.parseEther("1").toString());
    await tx.wait();
  });
});

describe("Presaler", function() {
  it("Should return correct admin", async function() {
    const actualAdmin = await presaler.admin();
    expect(actualAdmin).to.equal(presalerAdmin.address);
  });

  it("Admin should be able to change usage fee", async function() {
    const newUsageFee = ethers.BigNumber.from(200);
    const tx = await presaler.connect(presalerAdmin).changeUsageFee(newUsageFee);
    await tx.wait();
    const actualUsageFee = await presaler.usageFeeBPS();
    expect(actualUsageFee).to.equal(newUsageFee);
  });

  it("A user should be able to create a presale", async function() {
    const startTimes = [getOffsetTimestamp(-10)];
    const endTimes = [getOffsetTimestamp(20)];
    const tokenPrices = [ethers.BigNumber.from(100)];
    const tokenAddresses = [token.address];
    const tokenSupplies = [ethers.BigNumber.from(1000)];

    const tx = await presaler.connect(presaleCreator).startPresale(startTimes, endTimes, tokenPrices, tokenAddresses, tokenSupplies);
    await tx.wait();
  });

  it("A presale must have an end date greater than start date", async function() {
    const startTimes = [getOffsetTimestamp(10)];
    const endTimes = [getOffsetTimestamp(-10)];
    const tokenPrices = [ethers.BigNumber.from(100)];
    const tokenAddresses = [token.address];
    const tokenSupplies = [ethers.BigNumber.from(1000)];

    await expect(
      presaler.connect(presaleCreator).startPresale(startTimes, endTimes, tokenPrices, tokenAddresses, tokenSupplies)
    ).to.be.revertedWith('End date must be after the start date');
  });

  it("A user should be able to create two presales at once", async function() {
    const startTimes = [getOffsetTimestamp(-10), getOffsetTimestamp(10)];
    const endTimes = [getOffsetTimestamp(10), getOffsetTimestamp(20)];
    const tokenPrices = [ethers.BigNumber.from(100), ethers.BigNumber.from(200)];
    const tokenAddresses = [token.address, token.address];
    const tokenSupplies = [ethers.BigNumber.from(1000), ethers.BigNumber.from(2000)];

    const tx = await presaler.connect(presaleCreator).startPresale(startTimes, endTimes, tokenPrices, tokenAddresses, tokenSupplies);
    await tx.wait();
  });

  it("A user should be able to retrieve the IDs for the presales he created", async function() {
    const myPresales = await presaler.connect(presaleCreator).myPresales();
    expect([
      ethers.BigNumber.from(0), 
      ethers.BigNumber.from(1),  
      ethers.BigNumber.from(2), 
    ]).to.eql(myPresales); 
  });

  it("A presale must have parameter arrays must be the same length", async function() {
    const startTimes = [getOffsetTimestamp(-10), getOffsetTimestamp(-10), getOffsetTimestamp(-10)];
    const endTimes = [getOffsetTimestamp(0)];
    const tokenPrices = [ethers.BigNumber.from(100)];
    const tokenAddresses = [token.address];
    const tokenSupplies = [ethers.BigNumber.from(1000), ethers.BigNumber.from(5000)];

    await expect(
      presaler.connect(presaleCreator).startPresale(startTimes, endTimes, tokenPrices, tokenAddresses, tokenSupplies)
    ).to.be.revertedWith("Parameter arrays must be the same length");
  });

  it("Another user should not be able to buy presale token until it's been deposited by the creator", async function() {
    const presaleID = 0;
    let overrides = {value: 8};

    await expect(
      presaler.connect(buyer).buy(presaleID, overrides)
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  });

  
  it("A user should be able to transfer presale tokens to the presaler contract", async function() {
    const recipient = presaler.address;
    const amount = ethers.BigNumber.from(1000);
    await (await token.connect(owner).mint(presaleCreator.address, amount)).wait();
    await (await token.connect(presaleCreator).transfer(recipient, amount)).wait();
  });
  
  it("Another user should be able to buy a presale token", async function() {
    const presaleID = 0;
    let overrides = {value: 8};

    const tx = await presaler.connect(buyer).buy(presaleID, overrides);
    await tx.wait();
    const buyerTokenBalance = await token.connect(buyer).balanceOf(buyer.address);
    expect(buyerTokenBalance).to.equal(800);
  });

  it("A user should be able to withdraw unsold tokens", async function() {
    await ethers.provider.send("evm_increaseTime", [3600])
    const presaleID = 0;
    expect(await token.connect(buyer).balanceOf(presaleCreator.address)).to.equal(0);
    const tx = await presaler.connect(presaleCreator).withdraw(presaleID);
    await tx.wait();
    expect(await token.connect(buyer).balanceOf(presaleCreator.address)).to.equal(200);
  });

  it("Anyone should be able to \"end\" the presale", async function() {
    const presaleID = 0;
    await token.connect(owner).mint(presaler.address, ethers.utils.parseEther("1").toString());
    const tx = await presaler.connect(account2).endPresale(presaleID);
    await tx.wait();
  });
});