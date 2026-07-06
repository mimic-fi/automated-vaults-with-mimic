import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'
import { DepositRequest, RedeemRequest, SettleDeposit, SettleRedeem } from '../types/LagoonVault/ILagoonVault'
import { PendingRequest, VaultTotal } from '../types/schema'

const TARGET_DECIMALS: i32 = 18
const UNDERLYING_DECIMALS: i32 = 6
const SHARES_DECIMALS: i32 = 18

function pow10(exp: i32): BigInt {
  let r = BigInt.fromI32(1)
  for (let i = 0; i < exp; i++) r = r.times(BigInt.fromI32(10))
  return r
}

function to18(amount: BigInt, srcDecimals: i32): BigInt {
  if (srcDecimals == TARGET_DECIMALS) return amount
  if (srcDecimals > TARGET_DECIMALS) return amount.div(pow10(srcDecimals - TARGET_DECIMALS))
  return amount.times(pow10(TARGET_DECIMALS - srcDecimals))
}

export function handleDepositRequest(event: DepositRequest): void {
  const vaultTotal = loadOrCreateVaultTotal(event.address)
  const normalized = to18(event.params.assets, UNDERLYING_DECIMALS)

  const pendingRequest = new PendingRequest(getPendingRequestEntityId(event))
  pendingRequest.epoch = vaultTotal.epoch
  pendingRequest.kind = 'DEPOSIT'
  pendingRequest.user = event.params.owner
  pendingRequest.amount = normalized
  pendingRequest.blockNumber = event.block.number
  pendingRequest.save()

  vaultTotal.totalDeposit = vaultTotal.totalDeposit.plus(normalized)
  vaultTotal.net = vaultTotal.totalDeposit.minus(vaultTotal.totalRedeem)
  vaultTotal.save()
}

export function handleRedeemRequest(event: RedeemRequest): void {
  const vaultTotal = loadOrCreateVaultTotal(event.address)
  const normalized = to18(event.params.shares, SHARES_DECIMALS)

  const pendingRequest = new PendingRequest(getPendingRequestEntityId(event))
  pendingRequest.epoch = vaultTotal.epoch
  pendingRequest.kind = 'REDEEM'
  pendingRequest.user = event.params.owner
  pendingRequest.amount = normalized
  pendingRequest.blockNumber = event.block.number
  pendingRequest.save()

  vaultTotal.totalRedeem = vaultTotal.totalRedeem.plus(normalized)
  vaultTotal.net = vaultTotal.totalDeposit.minus(vaultTotal.totalRedeem)
  vaultTotal.save()
}

export function handleSettleDeposit(event: SettleDeposit): void {
  const vaultTotal = loadOrCreateVaultTotal(event.address)
  rotateVaultTotalEpoch(vaultTotal)
}

export function handleSettleRedeem(event: SettleRedeem): void {
  const vaultTotal = loadOrCreateVaultTotal(event.address)
  if (!vaultTotal.totalDeposit.isZero() || !vaultTotal.totalRedeem.isZero() || !vaultTotal.net.isZero())
    rotateVaultTotalEpoch(vaultTotal)
}

function rotateVaultTotalEpoch(vaultTotal: VaultTotal): void {
  vaultTotal.epoch = vaultTotal.epoch.plus(BigInt.fromI32(1))
  vaultTotal.totalDeposit = BigInt.zero()
  vaultTotal.totalRedeem = BigInt.zero()
  vaultTotal.net = BigInt.zero()
  vaultTotal.save()
}

function loadOrCreateVaultTotal(vault: Address): VaultTotal {
  const id = vault.toHexString().toLowerCase()
  let vaultTotal = VaultTotal.load(id)
  if (vaultTotal == null) {
    vaultTotal = new VaultTotal(id)
    vaultTotal.epoch = BigInt.zero()
    vaultTotal.totalDeposit = BigInt.zero()
    vaultTotal.totalRedeem = BigInt.zero()
    vaultTotal.net = BigInt.zero()
    vaultTotal.save()
  }
  return vaultTotal
}

function getPendingRequestEntityId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
}