import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Module de déploiement CryptoPixel V7 — SANS gouvernance
 *
 * Usage : bac à sable produit (Amoy). Sert à itérer vite sur le
 * frontend/indexer/Edge Functions, sans passer par le cycle Safe/Timelock
 * à chaque redeploy.
 *
 * owner() = guardian = premineHolder = ton EOA de déploiement, aucune
 * gouvernance multisig. NE JAMAIS utiliser ce module pour un déploiement
 * mainnet — c'est CryptoPixelModule.ts (avec Safe + Timelock) qu'il faut
 * utiliser pour ça.
 *
 * Testnet produit : npm run deploy:amoy-simple
 */
export default buildModule("CryptoPixelSimpleModule", (m) => {
  const cryptoPixel = m.contract("CryptoPixel");
  return { cryptoPixel };
});