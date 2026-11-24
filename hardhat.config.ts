import '@nomicfoundation/hardhat-ethers'
import type { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  solidity: '0.8.24',
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
  },
  paths: { sources: './contracts', tests: './contract-tests', cache: './cache', artifacts: './artifacts' },
}

export default config
