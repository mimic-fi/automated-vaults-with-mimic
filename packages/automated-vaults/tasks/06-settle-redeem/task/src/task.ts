import {
  Address,
  BigInt,
  DenominationToken,
  environment,
  evm,
  EvmCallBuilder,
  EvmDecodeParam,
  JSON,
  log,
  TokenAmount,
} from '@mimicprotocol/lib-ts'
import { SubgraphQueryResult } from '@mimicprotocol/lib-ts/src/queries'

import { CurrentInvestment, RedeemRequest, VaultTotalsResponse } from './taskTypes/types'
import { AavePoolUtils } from './types/AavePool'
import { CUSDCUtils } from './types/CUSDC'
import { ERC20 } from './types/ERC20'
import { MorphoVault, MorphoVaultUtils } from './types/MorphoVault'
import { SanctionedList } from './types/SanctionedList'
import { VaultUtils } from './types/Vault'
import { inputs } from './types'

export const PROTO_AAVE = 'aave'
export const PROTO_COMPOUND = 'compound'
export const PROTO_MORPHO = 'morpho'

export default function main(): void {
  const request = decodeRedeemRequest()
  if (checkSanctioned(request.owner)) return

  const fee = TokenAmount.fromStringDecimal(DenominationToken.USD(), inputs.feeAmount.toString())
  let builder = EvmCallBuilder.forChain(inputs.chainId).addMaxFee(fee).addUser(inputs.smartAccount)

  const subgraphResponse = getPendingDeposits()
  const net = getNet(subgraphResponse)
  log.info(`pending ${net}`)
  const currentTotal = getTotalUnderlyingAsset()
  const needed = assetsForShares(request.shares, currentTotal)
  log.info(`assetsForShares ${needed}`)

  if (net.lt(needed)) {
    // create exit from what's exactly needed
    const deficit = needed.minus(net)
    createExitCallFromCurrentProtocol(deficit, builder)
  }

  settleRedeemCall(inputs.vaultAddress, builder, fee, request, currentTotal)
}

function getNet(subgraphResponse: BigInt): BigInt {
  const underlying = new ERC20(inputs.USDC, inputs.chainId)
  const safeBalance = underlying.balanceOf(inputs.smartAccount).unwrap()
  // subgraph response comes in 18 decimals
  const subgraphScaled = scaleDecimals(subgraphResponse, 18, underlying.decimals().unwrap())
  return safeBalance.plus(subgraphScaled)
}

function decodeRedeemRequest(): RedeemRequest {
  const eventData = environment.getContext().trigger.getEventData()
  const controller = Address.fromString(evm.decode(new EvmDecodeParam('address', eventData.topics[1])))
  const owner = Address.fromString(evm.decode(new EvmDecodeParam('address', eventData.topics[2])))
  const tuple = JSON.parse<string[]>(evm.decode(new EvmDecodeParam('(address,uint256)', eventData.eventData)))
  const shares = BigInt.fromString(tuple[1])
  log.info(`shares from decode redeem ${shares}`)
  return new RedeemRequest(controller, owner, shares)
}

function checkSanctioned(userAddress: Address): bool {
  const sanctions = new SanctionedList(inputs.chainAnalysisAddress, inputs.chainId)
  return sanctions.isSanctioned(userAddress).unwrap()
}

function settleRedeemCall(
  vaultAddress: Address,
  builder: EvmCallBuilder,
  fee: TokenAmount,
  request: RedeemRequest,
  currentTotal: BigInt
): void {
  const updateAssetsData = VaultUtils.encodeUpdateNewTotalAssets(currentTotal)
  const settleRedeemData = VaultUtils.encodeSettleRedeem(currentTotal)
  const redeemShares = VaultUtils.encodeRedeemOnBehalf([request.owner])

  builder
    .addCall(vaultAddress, updateAssetsData)
    .addCall(vaultAddress, settleRedeemData)
    .addCall(vaultAddress, redeemShares)
    .addMaxFee(fee)
    .addUser(inputs.smartAccount)
    .build()
    .send()
}

function createExitCallFromCurrentProtocol(deficit: BigInt, builder: EvmCallBuilder): void {
  if (deficit.le(BigInt.zero())) return

  const holdings = getCurrentInvestment()
  if (holdings.length == 0) return

  const existing = findExistingInvestmentTarget(holdings)
  log.info(`creating exit call from protocol ${existing}`)
  if (existing.length == 0) return

  let maxAvailable = BigInt.zero()
  for (let i = 0; i < holdings.length; i++) {
    const holding = holdings[i]
    const protocol = resolveProtocol(holding.token.address.toHexString())
    if (protocol != existing) continue
    if (holding.amount.gt(maxAvailable)) maxAvailable = holding.amount
  }

  if (maxAvailable.le(BigInt.zero())) return

  let amount = deficit
  if (amount.gt(maxAvailable)) amount = maxAvailable

  if (existing == PROTO_AAVE) {
    redeemFromAave(amount, builder)
  } else if (existing == PROTO_COMPOUND) {
    redeemFromCompound(amount, builder)
  } else if (existing == PROTO_MORPHO) {
    redeemFromMorpho(amount, builder)
  }
}

function findExistingInvestmentTarget(holdings: CurrentInvestment[]): string {
  log.info('finding existing target')
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
  if (address == inputs.aUSDC.toHexString()) return PROTO_AAVE
  if (address == inputs.cUSDC.toHexString()) return PROTO_COMPOUND
  if (address == inputs.morphoVault.toHexString()) return PROTO_MORPHO
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

function assetsForShares(shares: BigInt, currentTotal: BigInt): BigInt {
  // const vault = new Vault(inputs.vaultAddress, inputs.chainId)
  // return vault.convertToAssets(shares)
  const shareToken = new ERC20(inputs.vaultAddress, inputs.chainId)
  const totalSupply = shareToken.totalSupply().unwrap()
  if (totalSupply.le(BigInt.zero())) return BigInt.zero()
  return shares.times(currentTotal.plus(new BigInt(1))).div(totalSupply)
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

function scaleDecimals(value: BigInt, from: i32, to: i32): BigInt {
  if (from == to) return value
  if (from < to) return value.upscale(<u8>(to - from))
  return value.downscale(<u8>(from - to))
}
