import { createConfig, rateLimit  } from "ponder";
import { CryptoPixelAbi } from "./abis/CryptoPixel";
import { http } from "viem";

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
    rpc: rateLimit(http(process.env.RPC_URL), {
        requestsPerSecond: 50,
    }),
  },
},
contracts: {
  CryptoPixel: {
    chain: chainName,
      address: process.env.CONTRACT_ADDRESS as `0x${string}`,
      abi: CryptoPixelAbi,
      startBlock: Number(process.env.START_BLOCK),
    },
  },
});