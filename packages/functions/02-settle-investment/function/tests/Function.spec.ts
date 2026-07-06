import {
  encodeEventExecution,
  fp,
  OpType,
  randomEvmAddress,
  randomHex,
  TriggerType,
  USD_ADDRESS,
} from '@mimicprotocol/sdk'
import { Call, Context, EvmCallQueryMock, runTask, SubgraphQueryMock } from '@mimicprotocol/test-ts'
import { expect } from 'chai'
import { AbiCoder, Interface } from 'ethers'

import AavePoolAbi from '../abis/AavePool.json'
import ERC20Abi from '../abis/ERC20.json'
import MorphoVaultAbi from '../abis/MorphoVault.json'

const ERC20Interface = new Interface(ERC20Abi)
const AavePoolInterface = new Interface(AavePoolAbi)
const MorphoVaultInterface = new Interface(MorphoVaultAbi)

describe('safe-investment-function', () => {
  const functionDir = './build'
  const user = '0x756f45e3fa69347a9a973a725e3c98bc4db0b5a0'

  const trigger = {
    type: TriggerType.Event,
    data: encodeEventExecution({
      blockHash: randomHex(32),
      index: 0,
      chainId: 8453,
      address: randomEvmAddress(),
      topics: [randomHex(32), randomHex(32), AbiCoder.defaultAbiCoder().encode(['address'], [user])],
      eventData: randomHex(32),
    }),
  }

  const context: Context = {
    user,
    settlers: [{ address: '0x0000000000000000000000000000000000000001', chainId: 8453 }],
    configSig: '682ec8210b1ce912da4d2952',
    trigger,
    timestamp: Date.now(),
  }

  const inputs = {
    chainId: 8453,
    USDC: '0x0000000000000000000000000000000000000002',
    smartAccount: '0x0000000000000000000000000000000000000003',
    aUSDC: '0x0000000000000000000000000000000000000004',
    aavePool: '0x0000000000000000000000000000000000000005',
    morphoVault: '0x0000000000000000000000000000000000000006',
    cUSDC: '0x0000000000000000000000000000000000000007',
    threshold: '0',
    feeAmount: 1,
    subgraphId: 'subgraph-id',
  }

  describe('when there are no assets in the safe', () => {
    it('produces no intents', async () => {
      const calls: EvmCallQueryMock[] = [
        {
          request: {
            to: inputs.USDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '0000000', abiType: 'uint256' },
        },
      ]

      const result = await runTask(functionDir, context, { inputs, calls })

      expect(result.intents).to.be.an('array').that.has.lengthOf(0)
    })
  })

  describe('preference for existing investment — when there is current investment', () => {
    it('deposits into morpho when morpho is the largest, even if Aave APY is higher', async () => {
      const safeUnderlying = '2000000'
      const ts = context.timestamp!
      const nowSec = String(Math.floor(ts / 1000))

      const calls: EvmCallQueryMock[] = [
        {
          request: {
            to: inputs.USDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: safeUnderlying, abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.USDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },

        {
          request: {
            to: inputs.aUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '1', abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.aUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },

        {
          request: {
            to: inputs.cUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '0', abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.cUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },

        {
          request: {
            to: inputs.morphoVault,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '9999', abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.morphoVault,
            chainId: inputs.chainId,
            fnSelector: MorphoVaultInterface.getFunction('convertToAssets')!.selector,
            params: [{ value: '9999', abiType: 'uint256' }],
          },
          response: { value: '9999', abiType: 'uint256' },
        },
      ]

      const subgraphQueries: SubgraphQueryMock[] = [
        {
          request: {
            timestamp: ts,
            chainId: inputs.chainId,
            subgraphId: inputs.subgraphId,
            query: `{yields {symbol weeklyYieldAave weeklyYieldCompound weeklyYieldMorpho lastUpdatedAave lastUpdatedCompound lastUpdatedMorpho}}`,
          },
          response: {
            blockNumber: 1,
            data: JSON.stringify({
              yields: [
                {
                  symbol: 'USDC',
                  weeklyYieldAave: '100',
                  weeklyYieldCompound: '0',
                  weeklyYieldMorpho: '0',
                  lastUpdatedAave: nowSec,
                  lastUpdatedCompound: nowSec,
                  lastUpdatedMorpho: nowSec,
                },
              ],
            }),
          },
        },
      ]

      const result = await runTask(functionDir, context, { inputs, calls, subgraphQueries })
      expect(result.success).to.equal(true)
      expect(result.timestamp).to.equal(ts)

      const intents = result.intents as Call[]
      expect(intents).to.have.lengthOf(1)

      expect(intents[0].op).to.equal(OpType.EvmCall)
      expect(intents[0].settler).to.equal(context.settlers?.[0].address)
      expect(intents[0].user).to.equal(inputs.smartAccount)
      expect(intents[0].chainId).to.equal(inputs.chainId)

      expect(intents[0].maxFees[0].token).to.equal(USD_ADDRESS)
      expect(intents[0].maxFees[0].amount).to.equal(fp(inputs.feeAmount).toString())

      const UINT256_MAX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      const expectedApprove = ERC20Interface.encodeFunctionData('approve', [inputs.morphoVault, UINT256_MAX])

      expect(intents[0].calls).to.be.an('array').that.is.not.empty
      expect(intents[0].calls[0].target.toLowerCase()).to.equal(inputs.USDC.toLowerCase())
      expect(intents[0].calls[0].value).to.equal('0')
      expect(intents[0].calls[0].data).to.equal(expectedApprove)

      const expectedDeposit = MorphoVaultInterface.encodeFunctionData('deposit', [safeUnderlying, inputs.smartAccount])

      expect(intents[0].calls[1].target.toLowerCase()).to.equal(inputs.morphoVault.toLowerCase())
      expect(intents[0].calls[1].value).to.equal('0')
      expect(intents[0].calls[1].data).to.equal(expectedDeposit)
    })
  })

  describe('when there are assets in the safe and no assets invested', () => {
    it('invests by best APY (aave)', async () => {
      const safeUnderlying = '2000000'
      const ts = context.timestamp!
      const nowSec = String(Math.floor(ts / 1000))

      const calls: EvmCallQueryMock[] = [
        {
          request: {
            to: inputs.USDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: safeUnderlying, abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.USDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },

        {
          request: {
            to: inputs.aUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '0', abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.aUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },

        {
          request: {
            to: inputs.cUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '0', abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.cUSDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },

        {
          request: {
            to: inputs.morphoVault,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
            params: [{ value: inputs.smartAccount, abiType: 'address' }],
          },
          response: { value: '0', abiType: 'uint256' },
        },
        {
          request: {
            to: inputs.morphoVault,
            chainId: inputs.chainId,
            fnSelector: MorphoVaultInterface.getFunction('convertToAssets')!.selector,
            params: [{ value: '0', abiType: 'uint256' }],
          },
          response: { value: '0', abiType: 'uint256' },
        },
      ]

      const subgraphQueries: SubgraphQueryMock[] = [
        {
          request: {
            timestamp: ts,
            chainId: inputs.chainId,
            subgraphId: inputs.subgraphId,
            query: `{yields {symbol weeklyYieldAave weeklyYieldCompound weeklyYieldMorpho lastUpdatedAave lastUpdatedCompound lastUpdatedMorpho}}`,
          },
          response: {
            blockNumber: 1,
            data: JSON.stringify({
              yields: [
                {
                  symbol: 'USDC',
                  weeklyYieldAave: '10',
                  weeklyYieldCompound: '1',
                  weeklyYieldMorpho: '2',
                  lastUpdatedAave: nowSec,
                  lastUpdatedCompound: nowSec,
                  lastUpdatedMorpho: nowSec,
                },
              ],
            }),
          },
        },
      ]

      const result = await runTask(functionDir, context, { inputs, calls, subgraphQueries })
      expect(result.success).to.equal(true)
      expect(result.timestamp).to.equal(ts)

      const intents = result.intents as Call[]
      expect(intents).to.have.lengthOf(1)

      expect(intents[0].op).to.equal(OpType.EvmCall)
      expect(intents[0].settler).to.equal(context.settlers?.[0].address)
      expect(intents[0].user).to.equal(inputs.smartAccount)
      expect(intents[0].chainId).to.equal(inputs.chainId)

      expect(intents[0].maxFees[0].token).to.equal(USD_ADDRESS)
      expect(intents[0].maxFees[0].amount).to.equal(fp(inputs.feeAmount).toString())

      const UINT256_MAX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      const expectedApprove = ERC20Interface.encodeFunctionData('approve', [inputs.aavePool, UINT256_MAX])

      expect(intents[0].calls).to.be.an('array').that.is.not.empty
      expect(intents[0].calls[0].target.toLowerCase()).to.equal(inputs.USDC.toLowerCase())
      expect(intents[0].calls[0].value).to.equal('0')
      expect(intents[0].calls[0].data).to.equal(expectedApprove)

      const expectedSupply = AavePoolInterface.encodeFunctionData('supply(address,uint256,address,uint16)', [
        inputs.USDC,
        safeUnderlying,
        inputs.smartAccount,
        0,
      ])
      expect(intents[0].calls[1].target.toLowerCase()).to.equal(inputs.aavePool.toLowerCase())
      expect(intents[0].calls[1].value).to.equal('0')
      expect(intents[0].calls[1].data).to.equal(expectedSupply)
    })
  })
})
