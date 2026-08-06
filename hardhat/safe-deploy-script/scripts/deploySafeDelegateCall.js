import 'dotenv/config'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { getCreateCallDeployment } from '@safe-global/safe-deployments'
import { ethers } from 'ethers'
import CryptoPixelArtifact from '../../artifacts/contracts/CryptoPixelV7.sol/CryptoPixel.json' with { type: 'json' }

const CHAIN_ID = 137n

async function main() {
  const createCallDeployment = getCreateCallDeployment({ network: CHAIN_ID.toString() })
  const createCallAddress = createCallDeployment.networkAddresses[CHAIN_ID.toString()]
  if (!createCallAddress) throw new Error('CreateCall non listé pour ce chainId')

  console.log('Adresse CreateCall utilisée (à vérifier sur Polygonscan) :', createCallAddress)

  // Le constructeur prend maintenant `admin` (address) en paramètre.
  // On encode cet argument et on le concatène au bytecode brut.
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const constructorArgs = abiCoder.encode(['address'], [process.env.SAFE_ADDRESS])
  const deploymentData = ethers.concat([CryptoPixelArtifact.bytecode, constructorArgs])

  const iface = new ethers.Interface(createCallDeployment.abi)
  const data = iface.encodeFunctionData('performCreate', [0, deploymentData])

  const protocolKit = await Safe.init({
    provider: process.env.RPC_URL,
    signer: process.env.PRIVATE_KEY_OWNER_1,
    safeAddress: process.env.SAFE_ADDRESS,
  })

  // operation: 0 = call normal (plus de delegatecall).
  // Comme performCreate exécute le CREATE dans le contexte de CreateCall,
  // et non plus dans celui du Safe, le déployeur "on-chain" (celui vu par
  // le tracer) sera CreateCall — mais ça n'a plus d'importance : owner,
  // guardian et premineHolder sont fixés explicitement via `admin` (le
  // Safe), passé en argument du constructeur, indépendamment de qui exécute
  // le CREATE.
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [{ to: createCallAddress, value: '0', data, operation: 0 }],
  })

  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction)
  const signature = await protocolKit.signHash(safeTxHash)

  const apiKit = new SafeApiKit({
    chainId: CHAIN_ID,
    apiKey: process.env.SAFE_API_KEY,
  })

  await apiKit.proposeTransaction({
    safeAddress: process.env.SAFE_ADDRESS,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: process.env.OWNER_1_ADDRESS,
    senderSignature: signature.data,
  })

  console.log('Transaction proposée, hash:', safeTxHash)
}

main().catch(console.error)