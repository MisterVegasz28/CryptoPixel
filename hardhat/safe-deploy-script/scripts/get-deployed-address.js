// get-deployed-address.js
import 'dotenv/config'
import { ethers } from 'ethers'
import { getCreateCallDeployment } from '@safe-global/safe-deployments'

const CHAIN_ID = 137n
const TX_HASH = process.argv[2] // hash de la tx Safe exécutée on-chain (pas le safeTxHash)

if (!TX_HASH) throw new Error('Usage: node get-deployed-address.js <tx_hash>')

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)

  const createCallDeployment = getCreateCallDeployment({ network: CHAIN_ID.toString() })
  const iface = new ethers.Interface(createCallDeployment.abi)

  const receipt = await provider.getTransactionReceipt(TX_HASH)
  if (!receipt) throw new Error('Receipt introuvable, tx pas encore minée ?')

  const event = receipt.logs
    .map(log => {
      try { return iface.parseLog(log) } catch { return null }
    })
    .find(parsed => parsed?.name === 'ContractCreation')

  if (!event) throw new Error('Event ContractCreation non trouvé dans les logs de cette tx')

  console.log('Adresse du contrat déployé :', event.args.newContract)
}

main().catch(console.error)