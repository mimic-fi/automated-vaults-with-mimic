import {
  encodeEventExecution,
  fp,
  OpType,
  randomEvmAddress,
  randomHex,
  TriggerType,
  USD_ADDRESS,
} from '@mimicprotocol/sdk'
import { Call, Context, EvmCallQueryMock, runTask, Swap, TokenPriceQueryMock } from '@mimicprotocol/test-ts'
import { expect } from 'chai'
import { AbiCoder, Interface } from 'ethers'

import CommetRewardsAbi from '../abis/CommetRewards.json'
import ERC20Abi from '../abis/ERC20.json'

const ERC20Interface = new Interface(ERC20Abi)
const CommetRewardsInterface = new Interface(CommetRewardsAbi)

describe('compound-rewards-claimer-function', () => {
  const functionDir = './build'

  const user = randomEvmAddress()
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
    settlers: [{ address: randomEvmAddress(), chainId: 8453 }],
    configSig: '682ec8210b1ce912da4d2952',
    trigger,
    timestamp: Date.now(),
  }

  const inputs = {
    chainId: 8453,
    smartAccount: '0x0000000000000000000000000000000000000001',
    cUSDC: '0x0000000000000000000000000000000000000002',
    compoundToken: '0x0000000000000000000000000000000000000003',
    USDC: '0x0000000000000000000000000000000000000004',
    feeAmount: 1,
    slippage: 10,
  }

  describe('when reward owed is zero', () => {
    it('produces no intents', async () => {
      const calls: EvmCallQueryMock[] = [
        {
          request: {
            to: inputs.compoundToken,
            chainId: inputs.chainId,
            fnSelector: CommetRewardsInterface.getFunction('getRewardOwed')!.selector,
            params: [
              { value: inputs.cUSDC, abiType: 'address' },
              { value: inputs.smartAccount, abiType: 'address' },
            ],
          },
          response: {
            value: AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [inputs.USDC, '0']),
            abiType: 'bytes',
          },
        },
      ]

      const prices: TokenPriceQueryMock[] = [
        { request: { token: inputs.USDC, chainId: inputs.chainId }, response: [fp(1).toString()] },
        { request: { token: inputs.USDC, chainId: inputs.chainId }, response: [fp(1).toString()] },
      ]

      const result = await runTask(functionDir, context, { inputs, calls, prices })

      expect(result.success).to.equal(true)
      expect(result.intents).to.be.an('array').that.has.lengthOf(0)
    })
  })

  describe('when reward owed is greater than zero', () => {
    it('claims rewards and swaps token', async () => {
      const rewardToken = '0x0000000000000000000000000000000000000005'
      const owed = '1000000'
      const expectedMinOut = '900000'

      const calls: EvmCallQueryMock[] = [
        {
          request: {
            to: inputs.compoundToken,
            chainId: inputs.chainId,
            fnSelector: CommetRewardsInterface.getFunction('getRewardOwed')!.selector,
            params: [
              { value: inputs.cUSDC, abiType: 'address' },
              { value: inputs.smartAccount, abiType: 'address' },
            ],
          },
          response: {
            value: AbiCoder.defaultAbiCoder().encode(['(address,uint256)'], [[rewardToken, owed]]),
            abiType: 'bytes',
          },
        },

        {
          request: {
            to: rewardToken,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('decimals')!.selector,
          },
          response: { value: '6', abiType: 'uint8' },
        },
        {
          request: {
            to: rewardToken,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('symbol')!.selector,
          },
          response: { value: 'RWD', abiType: 'string' },
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
            to: inputs.USDC,
            chainId: inputs.chainId,
            fnSelector: ERC20Interface.getFunction('symbol')!.selector,
          },
          response: { value: 'USDC', abiType: 'string' },
        },
      ]

      const prices: TokenPriceQueryMock[] = [
        { request: { token: rewardToken, chainId: inputs.chainId }, response: [fp(1).toString()] },
        { request: { token: inputs.USDC, chainId: inputs.chainId }, response: [fp(1).toString()] },
      ]

      const result = await runTask(functionDir, context, { inputs, calls, prices })
      expect(result.success).to.equal(true)
      expect(result.timestamp).to.equal(context.timestamp)

      const intents = result.intents
      expect(intents).to.have.lengthOf(2)

      const callIntent = intents[0] as Call
      const swapIntent = intents[1] as Swap

      expect(callIntent.op).to.equal(OpType.EvmCall)
      expect(callIntent.settler).to.equal(context.settlers?.[0].address)
      expect(callIntent.user).to.equal(inputs.smartAccount)
      expect(callIntent.chainId).to.equal(inputs.chainId)

      expect(callIntent.maxFees[0].token).to.equal(USD_ADDRESS)
      expect(callIntent.maxFees[0].amount).to.equal(fp(inputs.feeAmount).toString())

      const expectedClaim = CommetRewardsInterface.encodeFunctionData('claim', [
        inputs.cUSDC,
        inputs.smartAccount,
        false,
      ])

      expect(callIntent.calls).to.be.an('array').that.has.lengthOf(1)
      expect(callIntent.calls[0].target.toLowerCase()).to.equal(inputs.compoundToken.toLowerCase())
      expect(callIntent.calls[0].value).to.equal('0')
      expect(callIntent.calls[0].data).to.equal(expectedClaim)

      expect(swapIntent.op).to.equal(OpType.Swap)
      expect(swapIntent.settler).to.equal(context.settlers?.[0].address)
      expect(swapIntent.user).to.equal(inputs.smartAccount)

      expect(swapIntent.maxFees[0].token).to.equal(USD_ADDRESS)
      expect(swapIntent.maxFees[0].amount).to.equal(fp(inputs.feeAmount).toString())

      expect(swapIntent.sourceChain).to.equal(inputs.chainId)
      expect(swapIntent.destinationChain).to.equal(inputs.chainId)

      expect(swapIntent.tokensIn).to.have.lengthOf(1)
      expect(swapIntent.tokensIn[0].token.toLowerCase()).to.equal(rewardToken.toLowerCase())
      expect(swapIntent.tokensIn[0].amount).to.equal(owed)

      expect(swapIntent.tokensOut).to.have.lengthOf(1)
      expect(swapIntent.tokensOut[0].token.toLowerCase()).to.equal(inputs.USDC.toLowerCase())
      expect(swapIntent.tokensOut[0].recipient.toLowerCase()).to.equal(inputs.smartAccount.toLowerCase())
      expect(swapIntent.tokensOut[0].minAmount).to.equal(expectedMinOut)
    })
  })
})
