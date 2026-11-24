import { BrowserProvider, Contract, JsonRpcProvider, type Signer } from 'ethers'

export const registryAbi = [
  'function registerVersion(bytes32 documentHash, bytes32 parentHash, string title)',
  'function getVersion(bytes32 documentHash) view returns (address writer, uint64 registeredAt, bytes32 parentHash, string title, bool exists)',
  'event VersionRegistered(bytes32 indexed documentHash, address indexed writer, bytes32 indexed parentHash, uint64 registeredAt, string title)',
]

declare global { interface Window { ethereum?: { request: (...args: unknown[]) => Promise<unknown> } } }

export const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined
const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined

function isLoopbackRpc(value: string | undefined) {
  if (!value) return false
  try {
    const hostname = new URL(value).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch { return false }
}

export const canUseLocalDemoAccount = isLoopbackRpc(rpcUrl)

export function readContract() {
  if (!contractAddress) throw new Error('Registry address is missing. Deploy the contract and set VITE_CONTRACT_ADDRESS.')
  const provider = rpcUrl ? new JsonRpcProvider(rpcUrl) : window.ethereum ? new BrowserProvider(window.ethereum) : null
  if (!provider) throw new Error('No read-only RPC is configured and no wallet is connected.')
  return new Contract(contractAddress, registryAbi, provider)
}

export async function connectWallet(): Promise<{ signer: Signer; address: string; chainId: bigint }> {
  let provider: BrowserProvider | JsonRpcProvider
  if (window.ethereum) {
    provider = new BrowserProvider(window.ethereum)
    await provider.send('eth_requestAccounts', [])
  } else if (rpcUrl && canUseLocalDemoAccount) {
    // Hardhat exposes disposable, unlocked accounts on its local JSON-RPC node.
    // This fallback is deliberately restricted to loopback RPC URLs.
    provider = new JsonRpcProvider(rpcUrl)
    const accounts = await provider.send('eth_accounts', []) as string[]
    if (!accounts.length) throw new Error('No local demo account is available. Start the Hardhat chain with `npm run chain`.')
    const [signer, network] = await Promise.all([provider.getSigner(accounts[0]), provider.getNetwork()])
    return { signer, address: accounts[0], chainId: network.chainId }
  } else {
    throw new Error('No Ethereum wallet found. Start the local Hardhat chain for the demo, or install MetaMask for another network.')
  }
  const [signer, network] = await Promise.all([provider.getSigner(), provider.getNetwork()])
  return { signer, address: await signer.getAddress(), chainId: network.chainId }
}

export async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function shorten(value: string, chars = 6) {
  return `${value.slice(0, chars + 2)}…${value.slice(-4)}`
}

export function humanError(error: unknown) {
  const item = error as { shortMessage?: string; reason?: string; message?: string }
  return item.shortMessage ?? item.reason ?? item.message ?? 'Something went wrong. Please try again.'
}
