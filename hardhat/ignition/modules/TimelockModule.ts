import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TimelockModule", (m) => {
  const safeAddress = m.getParameter("safeAddress");
  const minDelay = m.getParameter("minDelay", 172800n); // 48h en mainnet

  const timelock = m.contract("TimelockControllerImport", [
    minDelay,
    [safeAddress], // proposers
    [safeAddress], // executors
    "0x0000000000000000000000000000000000000000", // le timelock s'auto-administre
  ]);

  return { timelock };
});