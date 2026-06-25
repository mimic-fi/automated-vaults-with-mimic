import { BigInt, dataSource, ethereum } from '@graphprotocol/graph-ts'

import { ICompound } from '../types/CompoundComet/ICompound'
import { IErc20 } from '../types/CompoundComet/IErc20'
import { Yield } from '../types/schema'
import { ONE_HOUR, SECONDS_PER_WEEK, SECONDS_PER_YEAR } from './constants/time'

const E18 = BigInt.fromI32(10)
  .pow(18 as u8)
  .toBigDecimal()

export function handleBlockCompound(block: ethereum.Block): void {
  const comet = ICompound.bind(dataSource.address())

  const util = comet.getUtilization()
  const rps = comet.getSupplyRate(util)
  const rpsBD = rps.toBigDecimal().div(E18)

  const apr = rpsBD.times(SECONDS_PER_YEAR)
  const weekly = rpsBD.times(SECONDS_PER_WEEK)

  const base = comet.baseToken()
  const id = base.toHexString().toLowerCase()

  let y = Yield.load(id)
  if (y == null) {
    y = new Yield(id)
    y.symbol = IErc20.bind(base).symbol()
  }

  const last = y.lastUpdatedCompound ? (y.lastUpdatedCompound as BigInt) : BigInt.zero()
  const elapsed = block.timestamp.minus(last)
  if (elapsed.lt(BigInt.fromI32(ONE_HOUR))) return

  y.annualPercentageCompound = apr
  y.weeklyYieldCompound = weekly
  y.lastUpdatedCompound = block.timestamp
  y.save()
}
