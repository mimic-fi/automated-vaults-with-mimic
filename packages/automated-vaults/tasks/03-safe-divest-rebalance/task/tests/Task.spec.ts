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
import { AbiCoder, Interface, keccak256, toUtf8Bytes } from 'ethers'

import ERC20Abi from '../abis/ERC20.json'
import MorphoVaultAbi from '../abis/MorphoVault.json'

const ERC20Interface = new Interface(ERC20Abi)
const MorphoVaultInterface = new Interface(MorphoVaultAbi)

describe('Task', () => {
  const taskDir = './build'
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
    settlers: [{ address: '0x0000000000000000000000000000000000000001', chainId: 8453 }],
    configSig: '682ec8210b1ce912da4d2952',
    trigger,
    timestamp: Date.now(),
  }

  const inputs = {
    aUSDC: '0x0000000000000000000000000000000000000002',
    chainId: 8453,
    aavePool: '0x0000000000000000000000000000000000000003',
    feeAmount: 2,
    morphoVault: '0x0000000000000000000000000000000000000004',
    smartAccount: '0x0000000000000000000000000000000000000005',
    cUSDC: '0x0000000000000000000000000000000000000006',
    USDC: '0x0000000000000000000000000000000000000007',
    subgraphId: 'subgraph-id',
  }

  const yieldsQuery = `{yields {symbol weeklyYieldAave weeklyYieldCompound weeklyYieldMorpho lastUpdatedAave lastUpdatedCompound lastUpdatedMorpho}}`

  describe('when there is current investment', () => {
    describe('when the current investment is different to best APY', () => {
      describe('when invested in morpho and redeem to aave', () => {
        it('produces the expected intents', async () => {
          const calls: EvmCallQueryMock[] = [
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
                to: inputs.cUSDC,
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
                to: inputs.morphoVault,
                chainId: inputs.chainId,
                fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
                params: [{ value: inputs.smartAccount, abiType: 'address' }],
              },
              response: { value: '100', abiType: 'uint256' },
            },
            {
              request: {
                to: inputs.morphoVault,
                chainId: inputs.chainId,
                fnSelector: MorphoVaultInterface.getFunction('convertToAssets')!.selector,
                params: [{ value: '100', abiType: 'uint256' }],
              },
              response: { value: '100', abiType: 'uint256' },
            },
            {
              request: {
                to: inputs.morphoVault,
                chainId: inputs.chainId,
                fnSelector: MorphoVaultInterface.getFunction('convertToShares')!.selector,
                params: [{ value: '100', abiType: 'uint256' }],
              },
              response: { value: '100', abiType: 'uint256' },
            },
          ]

          const subgraphQueries: SubgraphQueryMock[] = [
            {
              request: {
                timestamp: context.timestamp!,
                chainId: inputs.chainId,
                subgraphId: inputs.subgraphId,
                query: yieldsQuery,
              },
              response: {
                blockNumber: 1,
                data: '{ "yields": [{ "symbol": "USDC", "weeklyYieldAave": "1", "weeklyYieldCompound": "0", "weeklyYieldMorpho": "0", "lastUpdatedAave": "0", "lastUpdatedCompound": "0", "lastUpdatedMorpho": "0" }] }',
              },
            },
          ]

          const result = await runTask(taskDir, context, { inputs, calls, subgraphQueries })

          expect(result.success).to.equal(true)
          expect(result.timestamp).to.equal(context.timestamp)

          const intents = result.intents as Call[]
          expect(intents).to.have.lengthOf(1)

          expect(intents[0].op).to.equal(OpType.EvmCall)
          expect(intents[0].settler).to.equal(context.settlers?.[0].address)
          expect(intents[0].user).to.equal(inputs.smartAccount)
          expect(intents[0].chainId).to.equal(inputs.chainId)

          expect(intents[0].maxFees).to.have.length.greaterThan(0)
          expect(intents[0].maxFees[0].token).to.equal(USD_ADDRESS)
          expect(intents[0].maxFees[0].amount).to.equal(fp(inputs.feeAmount).toString())

          expect(intents[0].calls).to.have.lengthOf(1)

          const expectedRedeem = MorphoVaultInterface.encodeFunctionData('redeem', [
            '100',
            inputs.smartAccount,
            inputs.smartAccount,
          ])
          expect(intents[0].calls[0].target.toLowerCase()).to.equal(inputs.morphoVault.toLowerCase())
          expect(intents[0].calls[0].value).to.equal('0')
          expect(intents[0].calls[0].data).to.equal(expectedRedeem)

          expect(intents[0].events).to.have.lengthOf(1)
          expect(intents[0].events[0].topic).to.equal(keccak256(toUtf8Bytes('RedeemMorpho(uint256)')))
        })
      })
    })

    describe('when best APY equals current investment', () => {
      it('produces no intents', async () => {
        const calls: EvmCallQueryMock[] = [
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
              to: inputs.cUSDC,
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
              to: inputs.morphoVault,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
              params: [{ value: inputs.smartAccount, abiType: 'address' }],
            },
            response: { value: '250', abiType: 'uint256' },
          },
          {
            request: {
              to: inputs.morphoVault,
              chainId: inputs.chainId,
              fnSelector: MorphoVaultInterface.getFunction('convertToAssets')!.selector,
              params: [{ value: '250', abiType: 'uint256' }],
            },
            response: { value: '250', abiType: 'uint256' },
          },
        ]

        const subgraphQueries: SubgraphQueryMock[] = [
          {
            request: {
              timestamp: context.timestamp!,
              chainId: inputs.chainId,
              subgraphId: inputs.subgraphId,
              query: yieldsQuery,
            },
            response: {
              blockNumber: 1,
              data: '{ "yields": [{ "symbol": "USDC", "weeklyYieldAave": "0", "weeklyYieldCompound": "0", "weeklyYieldMorpho": "1", "lastUpdatedAave": "0", "lastUpdatedCompound": "0", "lastUpdatedMorpho": "0" }] }',
            },
          },
        ]

        const result = await runTask(taskDir, context, { inputs, calls, subgraphQueries })
        expect(result.intents).to.have.lengthOf(0)
      })
    })
  })

  describe('when there is no current investment', () => {
    it('produces no intents', async () => {
      const calls: EvmCallQueryMock[] = [
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
            to: inputs.cUSDC,
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
            timestamp: context.timestamp!,
            chainId: inputs.chainId,
            subgraphId: inputs.subgraphId,
            query: yieldsQuery,
          },
          response: {
            blockNumber: 1,
            data: '{ "yields": [{ "symbol": "USDC", "weeklyYieldAave": "1", "weeklyYieldCompound": "0", "weeklyYieldMorpho": "0", "lastUpdatedAave": "0", "lastUpdatedCompound": "0", "lastUpdatedMorpho": "0" }] }',
          },
        },
      ]

      const result = await runTask(taskDir, context, { inputs, calls, subgraphQueries })
      expect(result.intents).to.have.lengthOf(0)
    })
  })
})
