# InkChain demo files

These are fictional sample manuscripts for demonstrating registration and verification. Their contents are safe to put on a public test chain.

## Suggested walkthrough

1. Register `paper-harbor-v1.txt` with the version name **First draft**.
2. In **Activity**, click its fingerprint to copy it.
3. Register `paper-harbor-v2.txt` as **Revised draft** and paste the copied fingerprint into **Previous version**.
4. Repeat with `paper-harbor-v3.txt` as **Final draft** to build a three-version chain.
5. In **Verify a file**, choose any registered version and check for a match.
6. Choose `unregistered-story.txt` to show the no-match result.

Each version has different contents, so it produces a different fingerprint. Keep the local Hardhat node running during the demo; restarting it resets its on-chain records.
