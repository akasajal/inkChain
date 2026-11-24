# InkChain

InkChain records a cryptographic fingerprint for each manuscript version. The file is hashed in the browser and stays on the writer's device; the registry stores the SHA-256 hash, wallet address, timestamp, optional parent-version hash, and a short version label.

## Stack

- React, TypeScript, and Vite for the browser app
- Solidity 0.8.24 for the registry contract
- Hardhat for a local EVM chain and contract deployment
- ethers v6 for wallet and contract calls

## Run the local prototype

You need Node.js 20 or newer. A browser wallet is optional for the local demo.

1. Install dependencies: `npm install`
2. Start a local blockchain in one terminal: `npm run chain`
3. In another terminal, deploy the registry: `npm run deploy:local`
4. Start the web app: `npm run dev`
5. Open the local URL printed by Vite and choose **Use demo account**. InkChain uses the first disposable, unlocked account exposed by the local Hardhat node.

To connect MetaMask instead, add a local network using RPC `http://127.0.0.1:8545`, chain ID `31337`, and currency symbol `ETH`. Hardhat accounts and their keys are public test credentials and must never be used with real funds. The wallet-free demo signer is enabled only for loopback RPC URLs.

The deploy script writes the new contract address to `.env.local`. If Vite was already running, restart it so the frontend loads that address. The configured local RPC lets anyone verify a fingerprint without connecting a wallet; registration requires a wallet because it sends a transaction.

## Current prototype boundaries

- The activity list is stored in the current browser's local storage; the contract remains the source of truth. Clearing browser storage clears this convenience list, not blockchain records.
- Verification checks whether the exact file hash is present in the configured registry. A registered wallet and timestamp are evidence of a registration, not proof of a wallet holder's real-world identity or authorship.
- Manuscript contents are never uploaded by this app. The short label is public on-chain, so avoid putting confidential details in it.
- The sample is configured for a local Hardhat chain. A public testnet deployment needs a chosen chain, RPC endpoint, and deployment configuration.

## Project layout

```text
contracts/ManuscriptRegistry.sol  Solidity registry
scripts/deploy.ts                Local deployment script
src/App.tsx                      Registration, verification, and activity UI
src/chain.ts                     Wallet, hashing, and registry helpers
```
