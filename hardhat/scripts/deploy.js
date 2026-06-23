import hre from "hardhat";

async function main() {
  console.log("Deploying CryptoPixel...");

  const [signer] = await hre.ethers.getSigners();

  console.log("Deployer:", await signer.getAddress());

  const balance = await hre.ethers.provider.getBalance(await signer.getAddress());
  console.log("Balance:", hre.ethers.formatEther(balance), "MATIC");

  const factory = await hre.ethers.getContractFactory("CryptoPixel");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  console.log("✅ CryptoPixel deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});