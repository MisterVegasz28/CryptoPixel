import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Module de déploiement CryptoPixel V5
 *
 * Le constructeur ne prend aucun argument :
 *  - Premine automatique : 2 000 000 PAINT marketing (locked) + 500 000 PAINT team
 *  - msg.sender devient owner (Ownable2Step)
 *
 * Testnet : npm run deploy:amoy
 * Production : npm run deploy:polygon
 */
export default buildModule("CryptoPixelModule", (m) => {
  const cryptoPixel = m.contract("CryptoPixel");

  return { cryptoPixel };
});