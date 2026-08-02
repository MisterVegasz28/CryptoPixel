import { createConfig, rateLimit } from "ponder";
import { CryptoPixelAbi } from "./abis/CryptoPixel";
import { http, fallback } from "viem";

const chainName = process.env.CHAIN_NAME ?? "amoy";
const RPC_URL_BACKUP = process.env.RPC_URL_BACKUP ?? "";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    poolConfig: {
      ssl: {
        ca: process.env.SUPABASE_DB_CA_CERT,
        rejectUnauthorized: true,
      },
    },
  },


  chains: {
    [chainName]: {
      id: Number(process.env.CHAIN_ID ?? 80002),
      pollingInterval: 2_000, // au lieu du défaut ~1000ms car sur mainet polygon, nouveaux blocks toutes les 2 secondes
      rpc: rateLimit(
        RPC_URL_BACKUP
          ? fallback([http(process.env.RPC_URL), http(RPC_URL_BACKUP)])
          : http(process.env.RPC_URL),
        { requestsPerSecond: 50 }
      ),
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