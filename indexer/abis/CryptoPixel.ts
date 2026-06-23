export const CryptoPixelAbi = [
  { type: "event", name: "PixelFrozen",
    inputs: [
      { name: "pixelId", type: "uint32", indexed: true },
      { name: "owner",   type: "address", indexed: true },
      { name: "color",   type: "uint24" }
    ]
  },
  { type: "event", name: "TokensBought",
    inputs: [
      { name: "buyer",  type: "address", indexed: true },
      { name: "amount", type: "uint256" },
      { name: "cost",   type: "uint256" }
    ]
  },
  { type: "event", name: "TokensSold",
    inputs: [
      { name: "seller",  type: "address", indexed: true },
      { name: "amount",  type: "uint256" },
      { name: "revenue", type: "uint256" }
    ]
  },
] as const;