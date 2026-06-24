import { createConfig } from "ponder";
import { CryptoPixelAbi } from "./abis/CryptoPixel";

export default createConfig({
  // On déclare simplement qu'on utilise Postgres, 
  // Ponder lira la variable d'environnement DATABASE_URL tout seul.
  database: {
  kind: "postgres",
  poolConfig: {
  ssl: process.env.NODE_ENV === "production" ? true : { rejectUnauthorized: false },
},
},
  chains: {
    amoy: {
      id: 80002,
      rpc: "https://rpc-amoy.polygon.technology",
      ethGetLogsBlockRange: 100, // limite du RPC public Amoy
    },
  },
  contracts: {
    CryptoPixel: {
      chain: "amoy",
      address: process.env.CONTRACT_ADDRESS as `0x${string}`,
      abi: CryptoPixelAbi,
      startBlock: 40511084,
    },
  },
});