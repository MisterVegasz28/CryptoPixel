export const CryptoPixelAbi = [
  {
    type: "event", name: "PixelFrozen",
    inputs: [
      { name: "pixelId", type: "uint32",  indexed: true },
      { name: "owner",   type: "address", indexed: true },
      { name: "color",   type: "uint24",  indexed: false },
    ],
  },
  {
    type: "event", name: "BatchPixelFrozen",
    inputs: [
      { name: "owner",    type: "address",   indexed: true  },
      { name: "pixelIds", type: "uint32[]",  indexed: false },
      { name: "colors",   type: "uint24[]",  indexed: false },
    ],
  },
  {
    type: "event", name: "TokensBought",
    inputs: [
      { name: "buyer",  type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
      { name: "cost",   type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "TokensSold",
    inputs: [
      { name: "seller",  type: "address", indexed: true  },
      { name: "amount",  type: "uint256", indexed: false },
      { name: "revenue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "AirdropUnlocked",
    inputs: [
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event", name: "AirdropClaimed",
    inputs: [
      { name: "claimer", type: "address", indexed: true  },
      { name: "amount",  type: "uint256", indexed: false },
    ],
  },
] as const;