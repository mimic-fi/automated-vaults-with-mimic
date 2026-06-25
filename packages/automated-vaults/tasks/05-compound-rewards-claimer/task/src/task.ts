import {
  BigInt,
  DenominationToken,
  environment,
  ERC20Token,
  evm,
  EvmCallBuilder,
  EvmDecodeParam,
  log,
  SwapBuilder,
  SwapTokenIn,
  SwapTokenOut,
  TokenAmount,
} from '@mimicprotocol/lib-ts'

import { CommetRewardsUtils, RewardOwed } from './types/CommetRewards'
import { inputs } from './types'

export default function main(): void {
  log.info('initializing compound rewards claimer task')
  const commetRewards = getCommetRewards()
  log.info(`commet rewards ${commetRewards.owed.toString()}`)
  if (commetRewards.owed.gt(BigInt.zero())) {
    claimCommetRewards()
    swapCommetToken(commetRewards)
  }
  log.info('finished compound claimer task')
}

function getCommetRewards(): RewardOwed {
  const callData = CommetRewardsUtils.encodeGetRewardOwed(inputs.cUSDC, inputs.smartAccount).toHexString()
  const response = environment.evmCallQuery(inputs.compoundToken, inputs.chainId, callData).unwrap()
  const raw = evm.decode(new EvmDecodeParam('bytes', response))
  const decodedResponse = evm.decode(new EvmDecodeParam('(address,uint256)', raw))
  return RewardOwed.parse(decodedResponse)
}

function claimCommetRewards(): void {
  log.info('claiming rewards')
  //not accruing the balance, so we are able to swap all the tokens in this task
  const shouldAccrue = false
  const callData = CommetRewardsUtils.encodeClaim(inputs.cUSDC, inputs.smartAccount, shouldAccrue)
  const fee = TokenAmount.fromStringDecimal(DenominationToken.USD(), inputs.feeAmount.toString())
  EvmCallBuilder.forChain(inputs.chainId)
    .addCall(inputs.compoundToken, callData)
    .addUser(inputs.smartAccount)
    .addMaxFee(fee)
    .build()
    .send()
}

function swapCommetToken(commetRewards: RewardOwed): void {
  log.info('swapping token')
  const rewardToken = ERC20Token.fromAddress(commetRewards.token, inputs.chainId)
  const usdcToken = ERC20Token.fromAddress(inputs.USDC, inputs.chainId)
  const amountIn = TokenAmount.fromBigInt(rewardToken, commetRewards.owed)
  const expectedOut = amountIn.toTokenAmount(usdcToken).unwrap()
  log.info(`expectedOut ${expectedOut.amount}`)
  const HUNDRED = BigInt.fromI32(100)
  const slippageFactor = HUNDRED.minus(BigInt.fromI32(inputs.slippage as i32))
  const minAmount = expectedOut.amount.times(slippageFactor).div(HUNDRED)
  log.info(`minAmount ${minAmount}`)
  const fee = TokenAmount.fromStringDecimal(DenominationToken.USD(), inputs.feeAmount.toString())
  SwapBuilder.forChain(inputs.chainId)
    .addTokenIn(new SwapTokenIn(rewardToken.address, amountIn.amount))
    .addTokenOut(new SwapTokenOut(usdcToken.address, minAmount, inputs.smartAccount))
    .addUser(inputs.smartAccount)
    .addMaxFee(fee)
    .build()
    .send()
}
