import { BrowserProvider, Contract, JsonRpcProvider, type Signer } from 'ethers'

export const registryAbi = [
  'function registerVersion(bytes32 manuscriptId, bytes32 versionId, bytes32 parentVersionId, string manuscriptTitle, string versionLabel, string changeNote, string fileType, uint64 fileSize)',
  'function getVersion(bytes32 versionId) view returns (bytes32 manuscriptId, bytes32 parentVersionId, address writer, uint64 registeredAt, uint64 fileSize, string manuscriptTitle, string versionLabel, string changeNote, string fileType, bool exists)',
  'function getChildren(bytes32 versionId) view returns (bytes32[])',
  'function attestVersion(bytes32 versionId, uint8 role)',
  'function getAttestations(bytes32 versionId) view returns ((address signer, uint8 role, uint64 attestedAt)[])',
  'event VersionRegistered(bytes32 indexed versionId, bytes32 indexed manuscriptId, bytes32 indexed parentVersionId, address writer, uint64 registeredAt, uint64 fileSize, string manuscriptTitle, string versionLabel, string changeNote, string fileType)',
  'event VersionAttested(bytes32 indexed versionId, address indexed signer, uint8 role, uint64 attestedAt)',
]

declare global { interface Window { ethereum?: { request: (...args: unknown[]) => Promise<unknown> } } }

export const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined
const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined
export const registryDeploymentBlock = Number(import.meta.env.VITE_REGISTRY_DEPLOYMENT_BLOCK ?? 0)
const configuredChainIdValue = import.meta.env.VITE_CHAIN_ID as string | undefined
export const configuredChainId = configuredChainIdValue ? BigInt(configuredChainIdValue) : null

function isLoopbackRpc(value: string | undefined) {
  if (!value) return false
  try {
    const hostname = new URL(value).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch { return false }
}

export const canUseLocalDemoAccount = isLoopbackRpc(rpcUrl)

export function readProvider() {
  const provider = rpcUrl ? new JsonRpcProvider(rpcUrl) : window.ethereum ? new BrowserProvider(window.ethereum) : null
  if (!provider) throw new Error('No read-only RPC is configured and no wallet is connected.')
  return provider
}

export function readContract() {
  if (!contractAddress) throw new Error('Registry address is missing. Deploy the contract and set VITE_CONTRACT_ADDRESS.')
  return new Contract(contractAddress, registryAbi, readProvider())
}

export async function assertWalletNetwork(walletChainId: bigint) {
  const registryNetwork = await readProvider().getNetwork()
  if (configuredChainId !== null && walletChainId !== configuredChainId) {
    throw new Error(`Wallet is on chain ${walletChainId}; expected chain ${configuredChainId}.`)
  }
  if (configuredChainId !== null && registryNetwork.chainId !== configuredChainId) {
    throw new Error(`Registry RPC is on chain ${registryNetwork.chainId}; expected chain ${configuredChainId}.`)
  }
  if (walletChainId !== registryNetwork.chainId) {
    throw new Error(`Wallet is on chain ${walletChainId}, but the registry RPC is on chain ${registryNetwork.chainId}.`)
  }
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
  const item = error as { code?: string; shortMessage?: string; reason?: string; message?: string }
  const message = item.shortMessage ?? item.reason ?? item.message ?? ''
  if (item.code === 'ACTION_REJECTED') return 'The wallet request was cancelled.'
  if (/ECONNREFUSED|failed to fetch|fetch failed|could not detect network|network error/i.test(message)) {
    return 'Can’t reach the registry RPC. Start the Hardhat node with `npm run chain` and try again.'
  }
  if (/could not decode result data|bad_data/i.test(message)) {
    return 'The registry address has no compatible contract. Deploy the updated ManuscriptRegistry, then restart Vite.'
  }
  if (/expected chain|wallet is on chain|registry rpc is on chain/i.test(message)) {
    return `${message} Switch the wallet to the configured network and retry.`
  }
  return message || 'Something went wrong. Please try again.'
}
