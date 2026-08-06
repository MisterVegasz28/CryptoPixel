// checkGuard.js — identifie le guard actif
import Safe from '@safe-global/protocol-kit'
import 'dotenv/config'

const protocolKit = await Safe.init({
  provider: process.env.RPC_URL,
  signer: process.env.PRIVATE_KEY_OWNER_1,
  safeAddress: process.env.SAFE_ADDRESS,
})

const guardAddress = await protocolKit.getGuard()
console.log('Guard actif:', guardAddress)