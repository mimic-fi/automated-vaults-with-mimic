import { Chains, Client, EthersSigner, TriggerType } from '@mimicprotocol/sdk'
import { keccak256, toUtf8Bytes, Wallet } from 'ethers'

async function main() {
    const PRIVATE_KEY = process.env.PRIVATE_KEY
    if (!PRIVATE_KEY) throw new Error('Missing PRIVATE_KEY in .env file')

    const signer = EthersSigner.fromPrivateKey(PRIVATE_KEY)
    const client = new Client({ signer })

    const topic0 = '0xee2c98c99b683f71058b8744fea294a411482f07d55c98b392917e9286f22f13' // IntentExecuted
    const topic1 = '0x000000000000000000000000f792a57c7326bd9457765d7738d952361aa51d73' // user Smart account now this can be 0
    const topicAave = keccak256(toUtf8Bytes('RedeemAave(uint256)'))
    const topicCompound = keccak256(toUtf8Bytes('RedeemCompound(uint256)'))
    const topicMorpho = keccak256(toUtf8Bytes('RedeemMorpho(uint256)'))

    const trigger = {
        type: TriggerType.Event as const,
        chainId: Chains.Base,
        contract: '0x609d831C0068844e11eF85a273c7F356212Fd6D1', // settler
        topics : [
            [topic0],
            [topic1],
            [topicAave, topicCompound,topicMorpho ]
        ],
        delta: '5m',
        endDate: 0, // 0 means no end date. Remember to deactivate it manually from the explorer
    }
    const input = {
      chainId: 8453,
      USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      smartAccount: '0xf792a57c7326bd9457765d7738d952361aa51d73',
      aUSDC: '0x4e65fe4dba92790696d040ac24aa414708f5c0ab',
      aavePool: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
      morphoVault: '0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a',
      cUSDC: '0xb125e6687d4313864e53df431d5425969c15eb2f',
      threshold: '1',
      feeAmount: 1,
      subgraphId: "CkVeaqhi287jzHGAUTHJwUk89WnznTH6w774jJT491Ce"
    }
    const manifest = {
        version: "2.0.3",
        name: "safe-investment-rebalance-task-event-cid",
        description: "safe-investment-rebalance-task-event-cid",
        inputs: {
            chainId: "uint32",
            USDC: "address",
            smartAccount: "address",
            aUSDC: "address",
            aavePool: "address",
            morphoVault: "address",
            cUSDC: "address",
            threshold: "uint256",
            feeAmount: "uint32",
            subgraphId: "string"
        },
        abis: {
            ERC20: './abis/ERC20.json',
            Vault: './abis/lagoonVault.json',
        },
        metadata: { libVersion: '0.0.1-rc.20' },
    }
    const params = {
        //get this from /build in the deployed task
        taskCid: 'QmV7Ly5qFJY5qCA6gYVAjtLE6eTXky54wcYUACQdyzFiFC',
        description: 'Safe Investment event triggered task',
        input,
        trigger,
        version: '0.0.6',
        manifest,
        signer: new Wallet(PRIVATE_KEY).address,
        executionFeeLimit: '0',
        minValidations: 1,
    }

    await client.configs.signAndCreate(params)
}

main().catch(err => console.error('❌ Error:', err))