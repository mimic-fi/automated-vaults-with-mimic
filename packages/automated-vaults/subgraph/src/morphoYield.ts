import { BigDecimal, BigInt, dataSource, ethereum } from '@graphprotocol/graph-ts'

import { IMorpho } from '../types/MorphoVault/IMorpho'
import { Yield } from '../types/schema'
import { ZERO_BD, ZERO_BI } from './constants/numbers'
import { ONE_HOUR, SECONDS_PER_WEEK, SECONDS_PER_YEAR } from './constants/time'

export function handleBlockMorpho(block: ethereum.Block): void {
  const vault = IMorpho.bind(dataSource.address())

  const totalAssets = vault.totalAssets()
  const totalSupply = vault.totalSupply()
  if (totalSupply.le(ZERO_BI)) return

  const assetsBD = totalAssets.toBigDecimal()
  const supplyBD = totalSupply.toBigDecimal()
  if (supplyBD.le(ZERO_BD)) return

  const pps = assetsBD.div(supplyBD)

  const asset = vault.asset()
  const id = asset.toHexString().toLowerCase()

  let y = Yield.load(id)
  if (y == null) {
    y = new Yield(id)

    y.weeklyYieldMorpho = ZERO_BD
    y.annualPercentageMorpho = ZERO_BD
    y.lastUpdatedMorpho = block.timestamp
    y.lastPpsMorpho = pps
    y.lastTimestampMorpho = block.timestamp
    y.save()
    return
  }

  const lastUpd = y.lastUpdatedMorpho ? (y.lastUpdatedMorpho as BigInt) : ZERO_BI
  const elapsed = block.timestamp.minus(lastUpd)
  if (elapsed.lt(BigInt.fromI32(ONE_HOUR))) return

  const prevPpsMaybe = y.lastPpsMorpho
  const prevTsMaybe = y.lastTimestampMorpho

  if (prevPpsMaybe === null || prevTsMaybe === null) {
    y.lastPpsMorpho = pps
    y.lastTimestampMorpho = block.timestamp
    y.lastUpdatedMorpho = block.timestamp
    y.save()
    return
  }

  const prevPps = prevPpsMaybe as BigDecimal
  const prevTs = prevTsMaybe as BigInt

  const dt = block.timestamp.minus(prevTs)
  if (dt.le(ZERO_BI)) return

  if (prevPps.le(ZERO_BD)) {
    y.lastPpsMorpho = pps
    y.lastTimestampMorpho = block.timestamp
    y.lastUpdatedMorpho = block.timestamp
    y.save()
    return
  }

  const delta = pps.minus(prevPps)
  const dtBD = dt.toBigDecimal()
  if (dtBD.le(ZERO_BD)) return

  const rsec = delta.div(prevPps).div(dtBD)
  const apr = rsec.times(SECONDS_PER_YEAR)
  const weekly = rsec.times(SECONDS_PER_WEEK)

  y.annualPercentageMorpho = apr
  y.weeklyYieldMorpho = weekly
  y.lastPpsMorpho = pps
  y.lastTimestampMorpho = block.timestamp
  y.lastUpdatedMorpho = block.timestamp
  y.save()
}
