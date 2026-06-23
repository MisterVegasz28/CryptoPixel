import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://rpc-amoy.polygon.technology");
const abi = ["function paused() view returns (bool)", "function unpause()"];
const contract = new ethers.Contract("0xE9cF0f11BE0b653d1B456c2Fc9ad2C899bCCDddD", abi, provider);

const paused = await contract.paused();
console.log("Paused:", paused);