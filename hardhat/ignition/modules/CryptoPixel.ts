import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Module de déploiement CryptoPixel V7 + infra de gouvernance
 *
 * Prérequis AVANT de lancer ce module :
 *  - Le Safe multisig doit déjà être déployé (via app.safe.global),
 *    son adresse passée en paramètre `safeAddress`.
 *
 * Ce module déploie, dans l'ordre :
 *  1. TimelockController (réutilisable pour tous les futurs redeploys
 *     de CryptoPixel — pas besoin de le redéployer à chaque fois)
 *     - proposers : [Safe]  → seul le Safe peut proposer une action
 *     - executors : [Safe]  → seul le Safe peut exécuter après le délai
 *     - admin     : address(0) après setup (le Timelock s'auto-administre)
 *  2. CryptoPixel (le contrat métier — celui qu'on redeploie si besoin)
 *  3. transferOwnership(Timelock) — CryptoPixel.owner() devient le Timelock
 *  4. setGuardian(guardianAddress) — adresse opérationnelle rapide,
 *     SÉPARÉE du Timelock, pour pause()/unpause() instantané
 *
 * ⚠️ Actions post-script (à faire depuis l'UI Safe / Timelock) :
 *  - acceptOwnership() doit être schedulé PUIS exécuté via le Timelock
 *    (proposé par le Safe), pas appelé directement — CryptoPixel devient
 *    "vraiment" owned par le Timelock seulement après ce cycle complet.
 *
 * Testnet : npm run deploy:amoy
 * Production : npm run deploy:polygon
 */
export default buildModule("CryptoPixelModule", (m) => {
  const safeAddress = m.getParameter("safeAddress");
  const guardianAddress = m.getParameter("guardianAddress");

  // Délai en secondes. 3600 = 1h pour tester vite sur Amoy.
  // Monter à 86400 (24h) ou 172800 (48h) avant tout déploiement mainnet.
  const minDelay = m.getParameter("minDelay", 3600n);

  // ── 1. Timelock ──────────────────────────────────────────────────────
  const timelock = m.contract("TimelockControllerImport", [
    minDelay,
    [safeAddress], // proposers
    [safeAddress], // executors
    safeAddress,   // admin temporaire — à révoquer soi-même après coup
                    // (renounceRole(DEFAULT_ADMIN_ROLE, safeAddress) depuis
                    // le Safe une fois que tu es sûr que tout fonctionne)
  ]);

  // ── 2. CryptoPixel ───────────────────────────────────────────────────
  const cryptoPixel = m.contract("CryptoPixel");

  // ── 3 & 4. Ownership + guardian ──────────────────────────────────────
  m.call(cryptoPixel, "transferOwnership", [timelock]);
  m.call(cryptoPixel, "setGuardian", [guardianAddress]);

  return { cryptoPixel, timelock };
});