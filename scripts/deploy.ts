import { ethers } from 'hardhat'
import { writeFile } from 'node:fs/promises'

async function main() {
  const registry = await ethers.deployContract('ManuscriptRegistry')
  await registry.waitForDeployment()
  const address = await registry.getAddress()
  console.log(`ManuscriptRegistry deployed to ${address}`)
  await writeFile('.env.local', `VITE_CONTRACT_ADDRESS=${address}\nVITE_RPC_URL=http://127.0.0.1:8545\n`)
  console.log('Wrote .env.local; restart the Vite server if it is already running.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
