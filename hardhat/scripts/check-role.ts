import { network } from "hardhat";

async function main() {
    const { ethers } = await network.getOrCreate("polygon");

    const timelock = await ethers.getContractAt(
        "TimelockControllerImport",
        "0x457eDa44e61D56f220F1638a4c5cc940873a9327"
    );

    const role = await timelock.PROPOSER_ROLE();
    const safeAddress = "0xc580287A3C3dbd8F610DA0D3Ed7c4A5123A9A56b";
    const hasRole = await timelock.hasRole(role, safeAddress);

    console.log("PROPOSER_ROLE hash:", role);
    console.log("Safe address checked:", safeAddress);
    console.log("Safe has PROPOSER_ROLE:", hasRole);

    const minDelay = await timelock.getMinDelay();
    console.log("minDelay (seconds):", minDelay.toString());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});