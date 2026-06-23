import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Module de déploiement CryptoPixel v2
 *
 * Le constructeur ne prend aucun argument :
 *  - Le premine (200k marketing + 60k team) est minté automatiquement vers msg.sender
 *  - launchTime et unlockTime sont calculés depuis block.timestamp
 *
 * Déploiement :
 *   npx hardhat ignition deploy ignition/modules/CryptoPixel.ts --network <network>
 *
 * Déploiement production (avec optimizer) :
 *   HARDHAT_SOLIDITY_PROFILE=production npx hardhat ignition deploy ignition/modules/CryptoPixel.ts --network polygon
 */
export default buildModule("CryptoPixelModule", (m) => {
  const cryptoPixel = m.contract("CryptoPixel");

  return { cryptoPixel };
});