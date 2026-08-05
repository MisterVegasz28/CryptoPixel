// Réplique exacte de CryptoPixel.getPrice() (fonction `pure` du contrat —
// confirmé par l'ABI : stateMutability: "pure", donc duplication sûre côté client). Permet d'éviter un eth_call inutile afin d'économiser des Cu sur Alchemy
// Constantes START_PRICE et PRICE_SLOPE vérifiées sur le contrat (CryptoPixel.sol) :
// ce sont les bonnes valeurs confirmées par le contrat déployé sur la blockchain, et elles ne changent jamais.
const START_PRICE = 100_000_000_000_000_000n; // 0.1 ether
const PRICE_SLOPE = 500_000_000n;

export function getPrice(supplyInTokens: bigint, amountInTokens: bigint): bigint {
    return (
        START_PRICE * amountInTokens +
        ((PRICE_SLOPE * (2n * supplyInTokens * amountInTokens + amountInTokens * amountInTokens)) >> 1n)
    );
}