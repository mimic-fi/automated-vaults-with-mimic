import {
  Address,
  BigInt,
  Bytes,
  DenominationToken,
  environment,
  evm,
  EvmCallBuilder,
  EvmEncodeParam,
  JSON,
  log,
  TokenAmount,
} from '@mimicprotocol/lib-ts'
import { SubgraphQueryResult } from '@mimicprotocol/lib-ts/src/queries'

import { Candidate, CurrentInvestment, RedeemPlan, SubgraphResponse, Yields } from './functionTypes/types'
import { AavePoolUtils } from './types/AavePool'
import { CUSDCUtils } from './types/CUSDC'
import { ERC20 } from './types/ERC20'
import { MorphoVault, MorphoVaultUtils } from './types/MorphoVault'
import { inputs } from './types'

// 24 hours
const MAX_AGE_LAST_UPDATED = 86400

export default function main(): void {
  const bestAPY = getBestAPY()
  log.info(`best APY ${bestAPY.toHexString()}`)
  if (bestAPY == Address.zero()) {
    log.info('no best APY found')
    return
  }
  const currentInvestment = getCurrentInvestment()
  log.info(`currentInvestment ${currentInvestment[0].token.address.toHexString()}`)
  const plan = getRedeemPlan(currentInvestment, bestAPY)
  if (!plan) return
  createExitCallFromCurrentProtocol(plan, currentInvestment)
}

function getBestAPY(): Address {
  log.info('getting best APY')

  const nowMs = <f64>environment.getContext().timestamp
  const maxAgeMs = <f64>MAX_AGE_LAST_UPDATED * 1000.0
  const candidates = new Array<Candidate>()

  const subgraphResponse = getYields()
  const aaveTs: f64 = parseFloat(subgraphResponse.lastUpdatedAave) * 1000.0
  if (nowMs - aaveTs <= maxAgeMs) candidates.push(new Candidate('aave', parseFloat(subgraphResponse.weeklyYieldAave)))
  candidates.push(new Candidate('aave', parseFloat(subgraphResponse.weeklyYieldAave)))

  const compTs: f64 = parseFloat(subgraphResponse.lastUpdatedCompound) * 1000.0
  if (nowMs - compTs <= maxAgeMs)
    candidates.push(new Candidate('compound', parseFloat(subgraphResponse.weeklyYieldCompound)))
  candidates.push(new Candidate('compound', parseFloat(subgraphResponse.weeklyYieldCompound)))

  const morphoTs: f64 = parseFloat(subgraphResponse.lastUpdatedMorpho) * 1000.0
  if (nowMs - morphoTs <= maxAgeMs)
    candidates.push(new Candidate('morpho', parseFloat(subgraphResponse.weeklyYieldMorpho)))
  candidates.push(new Candidate('morpho', parseFloat(subgraphResponse.weeklyYieldMorpho)))

  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) if (candidates[i].rate > best.rate) best = candidates[i]
  if (best.candidate === 'aave') return inputs.aUSDC
  if (best.candidate === 'compound') return inputs.cUSDC
  if (best.candidate === 'morpho') return inputs.morphoVault
  return Address.zero()
}

function getYields(): Yields {
  const query = `{yields {symbol weeklyYieldAave weeklyYieldCompound weeklyYieldMorpho lastUpdatedAave lastUpdatedCompound lastUpdatedMorpho}}`
  const response = environment
    .subgraphQuery(inputs.chainId, inputs.subgraphId, query, null)
    .unwrapOr(new SubgraphQueryResult(0, ''))
  if (!response.data || response.data.length == 0) return new Yields('0', '0', '0', '0', '0', '0', '')

  const parsed = JSON.parse<SubgraphResponse>(response.data)
  if (!parsed.yields || parsed.yields.length == 0) return new Yields('0', '0', '0', '0', '0', '0', '')

  return parsed.yields[0]
}

function getCurrentInvestment(): CurrentInvestment[] {
  log.info('getting current investment')
  const underlying = new ERC20(inputs.USDC, inputs.chainId)
  const underlyingDecimals = underlying.decimals().unwrap()

  const aToken = new ERC20(inputs.aUSDC, inputs.chainId)
  const aTokenDecimals = aToken.decimals().unwrap()
  let aaveBalance = aToken.balanceOf(inputs.smartAccount).unwrap()
  if (aTokenDecimals != underlyingDecimals) aaveBalance = scaleDecimals(aaveBalance, aTokenDecimals, underlyingDecimals)
  log.info(`aaveBalance ${aaveBalance}`)

  const cToken = new ERC20(inputs.cUSDC, inputs.chainId)
  const cTokenDecimals = cToken.decimals().unwrap()
  let compoundBalance = cToken.balanceOf(inputs.smartAccount).unwrap()
  if (cTokenDecimals != underlyingDecimals)
    compoundBalance = scaleDecimals(compoundBalance, cTokenDecimals, underlyingDecimals)
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

function scaleDecimals(value: BigInt, from: i32, to: i32): BigInt {
  if (from == to) return value
  if (from < to) return value.upscale(<u8>(to - from))
  return value.downscale(<u8>(from - to))
}

function getRedeemPlan(currentInvestment: CurrentInvestment[], bestAPY: Address): RedeemPlan | null {
  log.info('getting redeem plan')
  if (currentInvestment.length == 0) {
    log.info('no current investments')
    return null
  }

  let needsRedeem = false
  for (let i = 0; i < currentInvestment.length; i++) {
    if (currentInvestment[i].token.address != bestAPY) {
      needsRedeem = true
      break
    }
  }

  if (!needsRedeem) {
    log.info('already invested in best APY, no redeem needed')
    return null
  }

  return new RedeemPlan(bestAPY)
}

function createExitCallFromCurrentProtocol(plan: RedeemPlan, currentInvestment: CurrentInvestment[]): void {
  log.info(`exiting protocol ${JSON.stringify(plan.to.toHexString())}`)
  const fee = TokenAmount.fromStringDecimal(DenominationToken.USD(), inputs.feeAmount.toString())
  let builder = EvmCallBuilder.forChain(inputs.chainId).addUser(inputs.smartAccount).addMaxFee(fee)

  for (let i = 0; i < currentInvestment.length; i++) {
    const current = currentInvestment[i]
    const currentAddress = current.token.address
    if (currentAddress == Address.zero() || currentAddress == plan.to) continue

    if (currentAddress == inputs.USDC) {
      redeemFromAave(current.amount, builder)
      emitDivestEvent(builder, 'RedeemAave(uint256)', current.amount)
    } else if (currentAddress == inputs.cUSDC) {
      redeemFromCompound(current.amount, builder)
      emitDivestEvent(builder, 'RedeemCompound(uint256)', current.amount)
    } else if (currentAddress == inputs.morphoVault) {
      redeemFromMorpho(current.amount, builder)
      emitDivestEvent(builder, 'RedeemMorpho(uint256)', current.amount)
    }
  }
  builder.addUser(inputs.smartAccount).build().send()
}

function emitDivestEvent(builder: EvmCallBuilder, signature: string, amount: BigInt): void {
  const topic = Bytes.fromHexString(evm.keccak(signature))
  const data = evm.encode([EvmEncodeParam.fromValue('uint256', amount)])
  builder.addEvent(topic, Bytes.fromHexString(data))
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
