import {
  Address,
  BigInt,
  Bytes,
  DenominationToken,
  environment,
  EvmCallBuilder,
  JSON,
  log,
  TokenAmount,
} from '@mimicprotocol/lib-ts'
import { SubgraphQueryResult } from '@mimicprotocol/lib-ts/src/queries'

import { Candidate, CurrentInvestment, SubgraphResponse, Yields } from './taskTypes/types'
import { AavePoolUtils } from './types/AavePool'
import { CUSDCUtils } from './types/CUSDC'
import { ERC20 } from './types/ERC20'
import { MorphoVault, MorphoVaultUtils } from './types/MorphoVault'
import { inputs } from './types'

const MAX_AGE_LAST_UPDATED = 86400
const UINT256_MAX = BigInt.fromHexString('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

export default function main(): void {
  let underlying = new ERC20(inputs.USDC, inputs.chainId)
  let safeBalance = underlying.balanceOf(inputs.smartAccount).unwrap()
  log.info(`balance in smart account ${safeBalance}`)

  if (safeBalance.gt(BigInt.zero())) {
    if (inputs.threshold && safeBalance.le(inputs.threshold)) return

    const fee = TokenAmount.fromStringDecimal(DenominationToken.USD(), inputs.feeAmount.toString())
    let builder = EvmCallBuilder.forChain(inputs.chainId).addUser(inputs.smartAccount).addMaxFee(fee)

    const currentTarget = getPreferredTarget()
    ensureAllowance(builder, currentTarget, fee)
    if (currentTarget.equals(inputs.aavePool)) {
      depositAave(builder, safeBalance)
    } else if (currentTarget.equals(inputs.morphoVault)) {
      depositMorpho(builder, safeBalance)
    } else if (currentTarget.equals(inputs.cUSDC)) {
      depositCompound(builder, safeBalance)
    }

    builder.build().send()
  } else {
    log.info(`No assets in safe ${safeBalance}`)
  }
}

function getPreferredTarget(): Address {
  log.info('getting preferred target')
  const existing = findExistingInvestmentTarget()
  if (!existing.equals(Address.zero())) return existing
  return getBestAPY()
}

function findExistingInvestmentTarget(): Address {
  log.info('finding existing target')
  const holdings = getCurrentInvestment()
  if (holdings.length == 0) {
    log.info('no current investments found')
    return Address.zero()
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
  return protocolToAddress(largestProtocol)
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

function scaleDecimals(value: BigInt, from: i32, to: i32): BigInt {
  if (from == to) return value
  if (from < to) return value.upscale(<u8>(to - from))
  return value.downscale(<u8>(from - to))
}

function resolveProtocol(addressHex: string): string {
  const addressLower = addressHex.toLowerCase()
  if (addressLower == inputs.aUSDC.toString().toLowerCase()) return 'aave'
  if (addressLower == inputs.cUSDC.toString().toLowerCase()) return 'compound'
  if (addressLower == inputs.morphoVault.toString().toLowerCase()) return 'morpho'
  return ''
}

function protocolToAddress(proto: string): Address {
  if (proto == 'aave') return inputs.aavePool
  if (proto == 'compound') return inputs.cUSDC
  if (proto == 'morpho') return inputs.morphoVault
  return Address.zero()
}

function getBestAPY(): Address {
  log.info('getting best APY')
  const subgraphResponse = getYields()

  const nowMs = <f64>environment.getContext().timestamp
  const maxAgeMs = <f64>MAX_AGE_LAST_UPDATED * 1000.0

  const candidates = new Array<Candidate>()

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
  if (best.candidate === 'aave') return inputs.aavePool
  if (best.candidate === 'compound') return inputs.cUSDC
  return inputs.morphoVault
}

function ensureAllowance(builder: EvmCallBuilder, spender: Address, fee: TokenAmount): void {
  const underlying = new ERC20(inputs.USDC, inputs.chainId)
  const approve = underlying.approve(spender, UINT256_MAX).addMaxFee(fee).build().calls[0]
  builder.addCall(underlying.address, Bytes.fromHexString(approve.data), BigInt.zero())
}

function depositAave(builder: EvmCallBuilder, safeBalance: BigInt): void {
  log.info('depositing in AAVE')
  const supplyData = AavePoolUtils.encodeSupply(inputs.USDC, safeBalance, inputs.smartAccount, 0)
  builder = builder.addCall(inputs.aavePool, supplyData)
}

function depositMorpho(builder: EvmCallBuilder, safeBalance: BigInt): void {
  log.info('depositing in Morpho')
  const depositData = MorphoVaultUtils.encodeDeposit(safeBalance, inputs.smartAccount)
  builder = builder.addCall(inputs.morphoVault, depositData)
}

function depositCompound(builder: EvmCallBuilder, safeBalance: BigInt): void {
  log.info('depositing in Compound')
  const supplyData = CUSDCUtils.encodeSupply(inputs.USDC, safeBalance)
  builder.addCall(inputs.cUSDC, supplyData)
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
