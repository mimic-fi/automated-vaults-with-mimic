import { Address, BigDecimal, BigInt, dataSource, ethereum, log } from '@graphprotocol/graph-ts'

import { IAaveProtocolDataProvider } from '../types/AaveProtocolDataProvider/IAaveProtocolDataProvider'
import { IErc20 } from '../types/AaveProtocolDataProvider/IErc20'
import { Yield } from '../types/schema'
import { ONE_HOUR, ONE_WEEK, SECONDS_PER_YEAR } from './constants/time'

const ONE = BigDecimal.fromString('1')
const ZERO_BD = BigDecimal.fromString('0')
const RAY = BigInt.fromString('1000000000000000000000000000')

export function handleBlockAave(block: ethereum.Block): void {
  const assetStr = dataSource.context().getString('aaveAsset')
  if (assetStr.length == 0) return

  const asset = Address.fromString(assetStr)
  const id = asset.toHexString().toLowerCase()

  let y = Yield.load(id)
  if (y == null) {
    y = new Yield(id)
    y.symbol = readSymbol(asset)
  }

  const last = y.lastUpdatedAave ? (y.lastUpdatedAave as BigInt) : BigInt.zero()
  const elapsed = block.timestamp.minus(last)
  if (elapsed.lt(BigInt.fromI32(ONE_HOUR))) return

  const provider = IAaveProtocolDataProvider.bind(dataSource.address())
  const res = provider.try_getReserveData(asset)
  if (res.reverted) {
    log.warning('AAVE:getReserveData reverted for asset {}', [asset.toHexString()])
    return
  }

  const liquidityRateRay = res.value.value5
  const apr = rayToDecimal(liquidityRateRay)
  const basePerSecond = ONE.plus(apr.div(SECONDS_PER_YEAR))
  const weekly = powInteger(basePerSecond, ONE_WEEK).minus(ONE)

  y.annualPercentageRateAave = apr
  y.weeklyYieldAave = weekly
  y.lastUpdatedAave = block.timestamp
  y.save()
}

function readSymbol(token: Address): string {
  const t = IErc20.bind(token).try_symbol()
  return t.reverted ? token.toHexString() : t.value
}
function rayToDecimal(v: BigInt): BigDecimal {
  return v.isZero() ? ZERO_BD : v.toBigDecimal().div(RAY.toBigDecimal())
}
function powInteger(base: BigDecimal, exp: i32): BigDecimal {
  let result = ONE
  let b = base
  let e = exp
  while (e > 0) {
    if ((e & 1) == 1) result = result.times(b)
    b = b.times(b)
    e = e >> 1
  }
  return result
}
