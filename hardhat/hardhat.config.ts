import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],

  paths: {
    sources: "./contracts",
  },

  solidity: {
    profiles: {
      default: {
        version: "0.8.35",
      },
      production: {
        version: "0.8.35",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          viaIR: true,
        },
      },
    },
  },

  test: {
    solidity: {
      invariant: {
        runs: 1000,
        depth: 50,
      },
    },
  },

  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    sepolia: {
      type: "http",
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: [configVariable("PRIVATE_KEY")],
      chainId: 11155111,
    },
    amoy: {
      type: "http",
      url: configVariable("ALCHEMY_RPC_URL"), // ta clé Alchemy Amoy existante
      accounts: [configVariable("PRIVATE_KEY")],
      chainId: 80002,
    },
    polygon: {
      type: "http",
      url: "https://polygon-rpc.com",
      accounts: [configVariable("PRIVATE_KEY")],
      chainId: 137,
    },
  },

  chainDescriptors: {
    80002: {
      name: "Polygon Amoy",
      blockExplorers: {
        etherscan: {
          name: "Polygonscan Amoy",
          url: "https://amoy.polygonscan.com",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },

  verify: {
    etherscan: {
      apiKey: configVariable("POLYGONSCAN_API_KEY"),
    },
    blockscout: {
      enabled: false,
    },
  },
});