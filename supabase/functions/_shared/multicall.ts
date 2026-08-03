import { ethers } from "ethers";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) external payable returns ((bool success, bytes returnData)[] returnData)",
];
const BALANCE_IFACE = new ethers.Interface([
    "function balanceOf(address account) view returns (uint256)",
    "function lockedPremine(address account) view returns (uint256)",
]);

const CHUNK_SIZE = 100;

export interface PainterBalances {
    balance: bigint;
    locked: bigint;
    ok: boolean;
}

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
            // Fix : .toLowerCase() forcé ici, au point d'écriture de la Map,
            // au lieu de compter sur le fait que tous les appelants normalisent déjà en amont.
            const painter = chunk[j].toLowerCase();
            const balRes = results[j * 2];
            const lockRes = results[j * 2 + 1];
            const ok = balRes.success && lockRes.success;

            const balance = balRes.success
                ? (BALANCE_IFACE.decodeFunctionResult("balanceOf", balRes.returnData)[0] as bigint)
                : 0n;
            const locked = lockRes.success
                ? (BALANCE_IFACE.decodeFunctionResult("lockedPremine", lockRes.returnData)[0] as bigint)
                : 0n;

            result.set(painter, { balance, locked, ok });
        }
    }

    return result;
}