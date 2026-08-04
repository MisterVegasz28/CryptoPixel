// Réplique exacte de CryptoPixel.getPrice() (fonction `pure` du contrat —
// confirmé par l'ABI : stateMutability: "pure", donc duplication sûre côté client).
// ⚠️ VÉRIFIER ces deux constantes contre le contrat déployé avant usage —
// une divergence ici fausse maxCost/minRevenue envoyés on-chain.
const START_PRICE = 100_000_000_000_000_000n; // 0.1 ether
const PRICE_SLOPE = 500_000_000n;

export function getPrice(supplyInTokens: bigint, amountInTokens: bigint): bigint {
    return (
        START_PRICE * amountInTokens +
        ((PRICE_SLOPE * (2n * supplyInTokens * amountInTokens + amountInTokens * amountInTokens)) >> 1n)
    );
}