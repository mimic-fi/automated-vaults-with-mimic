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
import VaultAbi from '../abis/LagoonVault.json'
import MorphoVaultAbi from '../abis/MorphoVault.json'
import SanctionedListAbi from '../abis/SanctionedList.json'

const ERC20Interface = new Interface(ERC20Abi)
const MorphoVaultInterface = new Interface(MorphoVaultAbi)
const SanctionedListInterface = new Interface(SanctionedListAbi)
const VaultInterface = new Interface(VaultAbi)
const AavePoolInterface = new Interface(AavePoolAbi)

describe('Function', () => {
  const functionDir = './build'
  const user = '0x756f45e3fa69347a9a973a725e3c98bc4db0b5a0'

  const controller = randomEvmAddress()
  const redeemShares = '400000'
  const trigger = {
    type: TriggerType.Event,
    data: encodeEventExecution({
      blockHash: randomHex(32),
      index: 0,
      chainId: 8453,
      address: randomEvmAddress(),
      topics: [
        randomHex(32),
        AbiCoder.defaultAbiCoder().encode(['address'], [controller]),
        AbiCoder.defaultAbiCoder().encode(['address'], [user]),
      ],
      eventData: AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [controller, redeemShares]),
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
    chainAnalysisAddress: '0x0000000000000000000000000000000000000001',
    chainId: 8453,
    smartAccount: '0x0000000000000000000000000000000000000002',
    feeAmount: 1,
    vaultAddress: '0x0000000000000000000000000000000000000003',
    aUSDC: '0x0000000000000000000000000000000000000004',
    cUSDC: '0x0000000000000000000000000000000000000005',
    morphoVault: '0x0000000000000000000000000000000000000006',
    aavePool: '0x0000000000000000000000000000000000000007',
    USDC: '0x0000000000000000000000000000000000000008',
    subgraphId: 'subgraph-id',
  }

  describe('when te user is not sanctioned', () => {
    describe('when the subgraph pending deposits is bigger than zero', () => {
      it('produces the expected intents', async () => {
        const calls: EvmCallQueryMock[] = [
          {
            request: {
              to: inputs.chainAnalysisAddress,
              chainId: inputs.chainId,
              fnSelector: SanctionedListInterface.getFunction('isSanctioned')!.selector,
              params: [{ value: user, abiType: 'address' }],
            },
            response: { value: false, abiType: 'bool' },
          },

          {
            request: {
              to: inputs.USDC,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
              params: [{ value: inputs.smartAccount, abiType: 'address' }],
            },
            response: { value: '100000000', abiType: 'uint256' },
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
              to: inputs.vaultAddress,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('totalSupply')!.selector,
            },
            response: { value: '10000000', abiType: 'uint256' },
          },

          {
            request: {
              to: inputs.aUSDC,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
              params: [{ value: inputs.smartAccount, abiType: 'address' }],
            },
            response: { value: '100000000', abiType: 'uint256' },
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
              timestamp: context.timestamp!,
              chainId: inputs.chainId,
              subgraphId: inputs.subgraphId,
              query: `{vaultTotals{net}}`,
            },
            response: {
              blockNumber: 1,
              data: '{ "vaultTotals": [{ "net": "000000000000000000" }] }',
            },
          },
        ]

        const result = await runTask(functionDir, context, { inputs, calls, subgraphQueries })

        expect(result.success).to.be.true
        expect(result.timestamp).to.be.equal(context.timestamp)

        const intents = result.intents as Call[]
        expect(intents).to.have.lengthOf(1)

        expect(intents[0].op).to.be.equal(OpType.EvmCall)
        expect(intents[0].settler).to.be.equal(context.settlers?.[0].address)
        expect(intents[0].user).to.be.equal(inputs.smartAccount)
        expect(intents[0].chainId).to.be.equal(inputs.chainId)

        expect(intents[0].maxFees).to.have.lengthOf(2)
        expect(intents[0].maxFees[0].token).to.be.equal(USD_ADDRESS)
        expect(intents[0].maxFees[0].amount).to.be.equal(fp(inputs.feeAmount).toString())

        expect(intents[0].calls).to.have.lengthOf(3)

        const expectedData1 = VaultInterface.encodeFunctionData('updateNewTotalAssets', ['200000000'])
        expect(intents[0].calls[0].target).to.be.equal(inputs.vaultAddress)
        expect(intents[0].calls[0].value).to.be.equal('0')
        expect(intents[0].calls[0].data).to.be.equal(expectedData1)

        const expectedData2 = VaultInterface.encodeFunctionData('settleRedeem', ['200000000'])
        expect(intents[0].calls[1].target).to.be.equal(inputs.vaultAddress)
        expect(intents[0].calls[1].value).to.be.equal('0')
        expect(intents[0].calls[1].data).to.be.equal(expectedData2)

        const expectedData3 = VaultInterface.encodeFunctionData('redeemOnBehalf', [[user]])
        expect(intents[0].calls[2].target).to.be.equal(inputs.vaultAddress)
        expect(intents[0].calls[2].value).to.be.equal('0')
        expect(intents[0].calls[2].data).to.be.equal(expectedData3)

        expect(result.logs.length).to.be.at.least(1)
        expect(result.logs.join(' ')).to.contain('shares from decode redeem')
      })
    })

    describe('when the subgraph pending deposits is lower than zero', () => {
      it('produces the expected intents divesting', async () => {
        const calls: EvmCallQueryMock[] = [
          {
            request: {
              to: inputs.chainAnalysisAddress,
              chainId: inputs.chainId,
              fnSelector: SanctionedListInterface.getFunction('isSanctioned')!.selector,
              params: [{ value: user, abiType: 'address' }],
            },
            response: { value: false, abiType: 'bool' },
          },

          {
            request: {
              to: inputs.USDC,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
              params: [{ value: inputs.smartAccount, abiType: 'address' }],
            },
            response: { value: '100000000', abiType: 'uint256' },
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
              to: inputs.vaultAddress,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('totalSupply')!.selector,
            },
            response: { value: '10000000', abiType: 'uint256' },
          },

          {
            request: {
              to: inputs.aUSDC,
              chainId: inputs.chainId,
              fnSelector: ERC20Interface.getFunction('balanceOf')!.selector,
              params: [{ value: inputs.smartAccount, abiType: 'address' }],
            },
            response: { value: '100000000', abiType: 'uint256' },
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
              timestamp: context.timestamp!,
              chainId: inputs.chainId,
              subgraphId: inputs.subgraphId,
              query: `{vaultTotals{net}}`,
            },
            response: {
              blockNumber: 1,
              data: '{ "vaultTotals": [{ "net": "-200000000000000000000" }] }',
            },
          },
        ]

        const result = await runTask(functionDir, context, { inputs, calls, subgraphQueries })
        expect(result.success).to.be.true
        expect(result.timestamp).to.be.equal(context.timestamp)

        const intents = result.intents as Call[]
        expect(intents).to.have.lengthOf(1)

        expect(intents[0].op).to.be.equal(OpType.EvmCall)
        expect(intents[0].settler).to.be.equal(context.settlers?.[0].address)
        expect(intents[0].user).to.be.equal(inputs.smartAccount)
        expect(intents[0].chainId).to.be.equal(inputs.chainId)

        expect(intents[0].maxFees).to.have.lengthOf(2)
        expect(intents[0].maxFees[0].token).to.be.equal(USD_ADDRESS)
        expect(intents[0].maxFees[0].amount).to.be.equal(fp(inputs.feeAmount).toString())

        expect(intents[0].calls).to.have.lengthOf(4)

        const withdrawData = AavePoolInterface.encodeFunctionData('withdraw(address,uint256,address)', [
          inputs.USDC,
          '100000000',
          inputs.smartAccount,
        ])
        expect(intents[0].calls[0].target).to.be.equal(inputs.aavePool)
        expect(intents[0].calls[0].value).to.be.equal('0')
        expect(intents[0].calls[0].data).to.be.equal(withdrawData)

        const updateAssetsData = VaultInterface.encodeFunctionData('updateNewTotalAssets', ['200000000'])
        expect(intents[0].calls[1].target).to.be.equal(inputs.vaultAddress)
        expect(intents[0].calls[1].value).to.be.equal('0')
        expect(intents[0].calls[1].data).to.be.equal(updateAssetsData)

        const settleRedeemData = VaultInterface.encodeFunctionData('settleRedeem', ['200000000'])
        expect(intents[0].calls[2].target).to.be.equal(inputs.vaultAddress)
        expect(intents[0].calls[2].value).to.be.equal('0')
        expect(intents[0].calls[2].data).to.be.equal(settleRedeemData)

        const redeemOnBehalfData = VaultInterface.encodeFunctionData('redeemOnBehalf', [[user]])
        expect(intents[0].calls[3].target).to.be.equal(inputs.vaultAddress)
        expect(intents[0].calls[3].value).to.be.equal('0')
        expect(intents[0].calls[3].data).to.be.equal(redeemOnBehalfData)

        expect(result.logs.length).to.be.at.least(1)
        expect(result.logs.join(' ')).to.contain('shares from decode redeem')
      })
    })
  })

  describe('when the user is sanctioned', () => {
    it('does not produces any intent', async () => {
      const calls: EvmCallQueryMock[] = [
        {
          request: {
            to: inputs.chainAnalysisAddress,
            chainId: inputs.chainId,
            fnSelector: SanctionedListInterface.getFunction('isSanctioned')!.selector,
            params: [{ value: user, abiType: 'address' }],
          },
          response: { value: true, abiType: 'bool' },
        },
      ]

      const result = await runTask(functionDir, context, { inputs, calls })
      expect(result.intents).to.have.lengthOf(0)

      expect(result.logs.length).to.be.at.least(1)
      expect(result.logs.join(' ')).to.contain('shares from decode redeem')
    })
  })
})
