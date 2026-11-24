# InkChain

InkChain records a cryptographic fingerprint for each manuscript version. The file is hashed in the browser and stays on the writer's device. The content fingerprint is the version ID; a separate random manuscript ID groups versions into a history.

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

The deploy script writes the new contract address to `.env.local`. If Vite was already running, restart it so the frontend loads that address. The configured local RPC lets anyone verify a fingerprint without connecting a wallet; registration and attestations require a wallet because they send transactions.

## Contract tests

Run the registry suite with `npm run test:contract`. It covers version metadata, parent/child links, duplicate fingerprints, invalid parent references, metadata validation, and Editor/Publisher attestations. If the pinned compiler is already unavailable offline but current Hardhat artifacts exist, run `npm run test:contract -- --no-compile`; recompile after any Solidity changes before relying on that mode.

## Version records

Each on-chain version stores its manuscript ID, parent version ID, registering wallet, timestamp, manuscript title, version label, optional change note, detected MIME type (or file extension when unavailable), and exact size in bytes. Children are derived from parent links and can branch; a version has no fixed single “next” version. The transaction receipt also contains the transaction hash and block number/hash, which the browser displays for records it registered. The change note and all other metadata are public on-chain. File contents and original filenames remain off-chain.

An Editor or Publisher can add an attestation by signing with a wallet and choosing a role. The contract records the signer address, declared role, and time, and prevents the same wallet from attesting the same version and role twice. These roles are declarations; the contract does not verify a person's identity or authority.

This version changes the registry contract interface. Existing deployments do not have these fields or functions. Restart the local chain if needed, redeploy with `npm run deploy:local`, and restart Vite before using the updated registration and attestation flows. Previous browser records remain viewable as legacy records but cannot provide the new on-chain details.

## Current prototype boundaries

- When the registry is connected, Overview and Activity rebuild their records from `VersionRegistered` events and refresh every 15 seconds. The browser list is only a cache while the registry is offline. Clearing browser storage does not delete blockchain records; reconnect to rebuild the list.
- Verification checks whether the exact file hash is present in the configured registry. A registered wallet and timestamp are evidence of a registration, not proof of a wallet holder's real-world identity or authorship.
- Manuscript contents are never uploaded by this app. Titles, version labels, file type, size, and change notes are public on-chain, so avoid putting confidential details in them.
- The sample is configured for a local Hardhat chain. A public testnet deployment needs a chosen chain, RPC endpoint, and deployment configuration.

## Project layout

```text
contracts/ManuscriptRegistry.sol  Solidity registry
scripts/deploy.ts                Local deployment script
contract-tests/                  Registry behavior tests
src/App.tsx                      Registration, verification, and activity UI
src/chain.ts                     Wallet, hashing, and registry helpers
```
