import { ethers } from "ethers";

// Multicall3 est déployé à la même adresse déterministe sur la quasi-
// totalité des chaînes EVM, y compris Polygon mainnet et Amoy testnet.
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) external payable returns ((bool success, bytes returnData)[] returnData)",
];
const BALANCE_IFACE = new ethers.Interface([
    "function balanceOf(address account) view returns (uint256)",
    "function lockedPremine(address account) view returns (uint256)",
]);

// Painters par appel multicall — 100 painters = 200 calls par lot, marge
// confortable sous les limites de taille de réponse eth_call habituelles
// des fournisseurs RPC (Alchemy/Infura).
const CHUNK_SIZE = 100;

export interface PainterBalances {
    balance: bigint;
    locked: bigint;
}

// Remplace 2×N appels RPC individuels (balanceOf + lockedPremine par
// painter) par un unique appel Multicall3.aggregate3 par lot.
export async function fetchBalancesMulticall(
    painters: string[],
    contractAddress: string,
    provider: ethers.Provider
): Promise<Map<string, PainterBalances>> {
    const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    const result = new Map<string, PainterBalances>();

    for (let i = 0; i < painters.length; i += CHUNK_SIZE) {
        const chunk = painters.slice(i, i + CHUNK_SIZE);
        const calls = chunk.flatMap((painter) => [
            { target: contractAddress, allowFailure: true, callData: BALANCE_IFACE.encodeFunctionData("balanceOf", [painter]) },
            { target: contractAddress, allowFailure: true, callData: BALANCE_IFACE.encodeFunctionData("lockedPremine", [painter]) },
        ]);

        const results: { success: boolean; returnData: string }[] = await multicall.aggregate3.staticCall(calls);

        for (let j = 0; j < chunk.length; j++) {
            const painter = chunk[j];
            const balRes = results[j * 2];
            const lockRes = results[j * 2 + 1];

            // allowFailure: true — un painter dont la lecture échoue (rare) ne
            // fait pas échouer tout le lot ; il retombe à 0 et sera retenté au
            // prochain run via le cursor existant (mark_painter_reconciled /
            // pending_purges), pas de perte silencieuse.
            const balance = balRes.success
                ? (BALANCE_IFACE.decodeFunctionResult("balanceOf", balRes.returnData)[0] as bigint)
                : 0n;
            const locked = lockRes.success
                ? (BALANCE_IFACE.decodeFunctionResult("lockedPremine", lockRes.returnData)[0] as bigint)
                : 0n;

            result.set(painter, { balance, locked });
        }
    }

    return result;
}