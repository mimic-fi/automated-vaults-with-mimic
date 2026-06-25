import {
  Address,
  BigInt,
  Bytes,
  DenominationToken,
  environment,
  evm,
  EvmCallBuilder,
  EvmDecodeParam,
  EvmEncodeParam,
  JSON,
  log,
  TokenAmount,
} from '@mimicprotocol/lib-ts'
import { SubgraphQueryResult } from '@mimicprotocol/lib-ts/src/queries'

import { CurrentInvestment, VaultTotalsResponse } from './taskTypes/types'
import { AavePoolUtils } from './types/AavePool'
import { CUSDCUtils } from './types/CUSDC'
import { ERC20 } from './types/ERC20'
import { MorphoVault, MorphoVaultUtils } from './types/MorphoVault'
import { SanctionedList } from './types/SanctionedList'
import { VaultUtils } from './types/Vault'
import { inputs } from './types'

const PROTOCOL_AAVE = 'aave'
const PROTOCOL_COMPOUND = 'compound'
const PROTOCOL_MORPHO = 'morpho'
const UINT256_MAX = BigInt.fromHexString('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

export default function main(): void {
  const owner = decodeDepositRequest()
  const isSanctioned = checkSanctioned(owner)

  if (isSanctioned) {
    log.info(`User sanctioned ${owner.toHexString()}`)
    return
  }
  log.info(`User not sanctioned ${owner.toHexString()}`)

  const fee = TokenAmount.fromStringDecimal(DenominationToken.USD(), inputs.feeAmount.toString())
  let builder = EvmCallBuilder.forChain(inputs.chainId).addMaxFee(fee).addUser(inputs.smartAccount)
  ensureAllowance(builder, fee)
  const subgraphResponse = getPendingDeposits()
  if (subgraphResponse.lt(BigInt.zero())) {
    log.info('net balance from subgraph is less than zero, analyzing divestment ')
    const net = getNet(subgraphResponse)
    if (net.lt(BigInt.zero())) {
      log.info(`net ${net}, divesting`)
      createExitCallFromCurrentProtocol(net.abs(), builder)
    } else {
      log.info(`net ${net}, no need to divest`)
    }
  } else {
    log.info('net balance from subgraph is bigger than 0 no need to divest USDC')
  }
  settleDepositCall(inputs.vaultAddress, builder, fee, owner)
}

function decodeDepositRequest(): Address {
  const eventData = environment.getContext().trigger.getEventData()
  return Address.fromString(evm.decode(new EvmDecodeParam('address', eventData.topics[2])))
}

function ensureAllowance(builder: EvmCallBuilder, fee: TokenAmount): void {
  const underlying = new ERC20(inputs.USDC, inputs.chainId)
  const approve = underlying.approve(inputs.vaultAddress, UINT256_MAX).addMaxFee(fee).build().calls[0]
  builder.addCall(underlying.address, Bytes.fromHexString(approve.data), BigInt.zero())
}

function getNet(subgraphResponse: BigInt): BigInt {
  const underlying = new ERC20(inputs.USDC, inputs.chainId)
  const safeBalance = underlying.balanceOf(inputs.smartAccount).unwrap()
  // subgraph response is in 18 decimals
  const subgraphScaled = scaleDecimals(subgraphResponse, 18, underlying.decimals().unwrap())
  return safeBalance.plus(subgraphScaled)
}

function scaleDecimals(value: BigInt, from: i32, to: i32): BigInt {
  if (from == to) return value
  if (from < to) return value.upscale(<u8>(to - from))
  return value.downscale(<u8>(from - to))
}

function checkSanctioned(userAddress: Address): bool {
  const sanctions = new SanctionedList(inputs.chainAnalysisAddress, inputs.chainId)
  return sanctions.isSanctioned(userAddress).unwrap()
}

function createExitCallFromCurrentProtocol(net: BigInt, builder: EvmCallBuilder): void {
  const existing = findExistingInvestmentTarget()
  if (existing == PROTOCOL_AAVE) {
    redeemFromAave(net, builder)
  } else if (existing == PROTOCOL_COMPOUND) {
    redeemFromCompound(net, builder)
  } else if (existing == PROTOCOL_MORPHO) {
    redeemFromMorpho(net, builder)
  }
}

function settleDepositCall(vaultAddress: Address, builder: EvmCallBuilder, fee: TokenAmount, owner: Address): void {
  const currentTotal = getTotalUnderlyingAsset()
  const updateAssetsData = VaultUtils.encodeUpdateNewTotalAssets(currentTotal)
  const settleDepositData = VaultUtils.encodeSettleDeposit(currentTotal)
  const claimSharesData = VaultUtils.encodeClaimSharesOnBehalf([owner])
  emitDepositEvent(builder, 'DepositRequestSucceeded(uint256)', currentTotal)

  builder
    .addCall(vaultAddress, updateAssetsData)
    .addCall(vaultAddress, settleDepositData)
    .addCall(vaultAddress, claimSharesData)
    .addMaxFee(fee)
    .addUser(inputs.smartAccount)
    .build()
    .send()
}

function findExistingInvestmentTarget(): string {
  log.info('finding existing target')
  const holdings = getCurrentInvestment()
  if (holdings.length == 0) {
    log.info('no current investments found')
    return ''
  }

  let largestProtocol = ''
  let largestAmount = BigInt.zero()
  for (let i = 0; i < holdings.length; i++) {
    const holding = holdings[i]
    if (holding.amount.le(BigInt.zero())) continue
    const protocol = resolveProtocol(holding.token.address.toHexString())
    if (protocol.length == 0) continue
    if (holding.amount.gt(largestAmount)) {
      largestAmount = holding.amount
      largestProtocol = protocol
    }
  }
  return largestProtocol
}

function getCurrentInvestment(): CurrentInvestment[] {
  log.info('getting current investment')
  const underlying = new ERC20(inputs.USDC, inputs.chainId)

  const aToken = new ERC20(inputs.aUSDC, inputs.chainId)
  let aaveBalance = aToken.balanceOf(inputs.smartAccount).unwrap()
  if (aToken.decimals() != underlying.decimals())
    aaveBalance = scaleDecimals(aaveBalance, aToken.decimals().unwrap(), underlying.decimals().unwrap())
  log.info(`aaveBalance ${aaveBalance}`)

  const cToken = new ERC20(inputs.cUSDC, inputs.chainId)
  let compoundBalance = cToken.balanceOf(inputs.smartAccount).unwrap()
  if (cToken.decimals() != underlying.decimals())
    compoundBalance = scaleDecimals(compoundBalance, cToken.decimals().unwrap(), underlying.decimals().unwrap())
  log.info(`compoundBalance ${compoundBalance}`)

  const mToken = new ERC20(inputs.morphoVault, inputs.chainId)
  const vaultMorpho = new MorphoVault(inputs.morphoVault, inputs.chainId)
  const morphoShares = vaultMorpho.balanceOf(inputs.smartAccount).unwrap()
  const morphoBalance = vaultMorpho.convertToAssets(morphoShares).unwrap()
  // there is no need to scale decimals here because assets are in 6 as USDC
  log.info(`morphoBalance ${morphoBalance}`)

  const current: CurrentInvestment[] = []
  if (aaveBalance.gt(BigInt.zero())) current.push(new CurrentInvestment(aToken, aaveBalance))
  if (morphoBalance.gt(BigInt.zero())) current.push(new CurrentInvestment(mToken, morphoBalance))
  if (compoundBalance.gt(BigInt.zero())) current.push(new CurrentInvestment(cToken, compoundBalance))

  return current
}

function resolveProtocol(address: string): string {
  if (address == inputs.aUSDC.toHexString()) return PROTOCOL_AAVE
  if (address == inputs.cUSDC.toHexString()) return PROTOCOL_COMPOUND
  if (address == inputs.morphoVault.toHexString()) return PROTOCOL_MORPHO
  return ''
}

function redeemFromAave(amount: BigInt, builder: EvmCallBuilder): void {
  const withdrawData = AavePoolUtils.encodeWithdraw(inputs.USDC, amount, inputs.smartAccount)
  builder.addCall(inputs.aavePool, withdrawData)
}

function redeemFromCompound(amount: BigInt, builder: EvmCallBuilder): void {
  const withdrawData = CUSDCUtils.encodeWithdraw(inputs.USDC, amount)
  builder.addCall(inputs.cUSDC, withdrawData)
}

function redeemFromMorpho(assets: BigInt, builder: EvmCallBuilder): void {
  const vaultMorpho = new MorphoVault(inputs.morphoVault, inputs.chainId)
  const shares = vaultMorpho.convertToShares(assets).unwrap()
  const redeemData = MorphoVaultUtils.encodeRedeem(shares, inputs.smartAccount, inputs.smartAccount)
  builder.addCall(inputs.morphoVault, redeemData)
}

function getPendingDeposits(): BigInt {
  const query = `{vaultTotals{net}}`
  const response = environment
    .subgraphQuery(inputs.chainId, inputs.subgraphId, query, null)
    .unwrapOr(new SubgraphQueryResult(0, '0'))
  if (!response.data || response.data.length == 0) return BigInt.zero()
  const parsed = JSON.parse<VaultTotalsResponse>(response.data)
  if (!parsed.vaultTotals || parsed.vaultTotals.length == 0) return BigInt.zero()
  const net = parsed.vaultTotals[0].net
  if (!net || net.length == 0) return BigInt.zero()
  return BigInt.fromString(net)
}

function emitDepositEvent(builder: EvmCallBuilder, signature: string, amount: BigInt): void {
  const topic = Bytes.fromHexString(evm.keccak(signature))
  const data = evm.encode([EvmEncodeParam.fromValue('uint256', amount)])
  builder.addEvent(topic, Bytes.fromHexString(data))
}

function getTotalUnderlyingAsset(): BigInt {
  const underlying = new ERC20(inputs.USDC, inputs.chainId)
  const safeBalance = underlying.balanceOf(inputs.smartAccount).unwrap()
  log.info(`safeBalance ${safeBalance}`)

  const aToken = new ERC20(inputs.aUSDC, inputs.chainId)
  let aaveBalance = aToken.balanceOf(inputs.smartAccount).unwrap()
  if (aToken.decimals() != underlying.decimals())
    aaveBalance = scaleDecimals(aaveBalance, aToken.decimals().unwrap(), underlying.decimals().unwrap())
  log.info(`aaveBalance ${aaveBalance}`)

  const cToken = new ERC20(inputs.cUSDC, inputs.chainId)
  let compoundBalance = cToken.balanceOf(inputs.smartAccount).unwrap()
  if (cToken.decimals() != underlying.decimals())
    compoundBalance = scaleDecimals(compoundBalance, cToken.decimals().unwrap(), underlying.decimals().unwrap())
  log.info(`compoundBalance ${compoundBalance}`)

  const vaultMorpho = new MorphoVault(inputs.morphoVault, inputs.chainId)
  const morphoShares = vaultMorpho.balanceOf(inputs.smartAccount).unwrap()
  const morphoBalance = vaultMorpho.convertToAssets(morphoShares).unwrap()
  // there is no need to scale decimals here because assets are in 6 as USDC
  log.info(`morphoBalance ${morphoBalance}`)

  return aaveBalance.plus(compoundBalance).plus(morphoBalance).plus(safeBalance)
}
