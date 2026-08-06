import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TimelockModule", (m) => {
  const safeAddress = m.getParameter("safeAddress");
  const minDelay = m.getParameter("minDelay", 172800n); // 48h en mainnet

  const timelock = m.contract("TimelockControllerImport", [
    minDelay,
    [safeAddress], // proposers
    [safeAddress], // executors
    safeAddress,   // admin temporaire — à révoquer après coup
  ]);

  return { timelock };
});