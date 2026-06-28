import { createConfig } from "ponder";
import { CryptoPixelAbi } from "./abis/CryptoPixel";

const chainName = process.env.CHAIN_NAME ?? "amoy";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    poolConfig: {
      ssl: {
        rejectUnauthorized: false,
      },
    },
  },
  // ... reste inchangé

chains: {
  [chainName]: {
    id: Number(process.env.CHAIN_ID ?? 80002),
    rpc: process.env.RPC_URL ?? "https://rpc-amoy.polygon.technology",
    ethGetLogsBlockRange: 100,
  },
},
contracts: {
  CryptoPixel: {
    chain: chainName,
      address: process.env.CONTRACT_ADDRESS as `0x${string}`,
      abi: CryptoPixelAbi,
      startBlock: Number(process.env.START_BLOCK ?? 40792616),
    },
  },
});