const hre = require("hardhat");

async function main() {
  const adminAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const usageFeeBPS = 100;
  const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  const Presaler = await hre.ethers.getContractFactory("Presaler");
  const presaler = await Presaler.deploy(adminAddress, usageFeeBPS, uniswapRouterAddress);

  await presaler.deployed();
  console.log("Presaler deployed to:", presaler.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
