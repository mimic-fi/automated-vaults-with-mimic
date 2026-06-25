import { Address, BigInt } from '@mimicprotocol/lib-ts'

import { ERC20 } from '../types/ERC20'

export class CurrentInvestment {
  constructor(
    public token: ERC20,
    public amount: BigInt
  ) {}
}

export class RedeemPlan {
  constructor(public to: Address) {}
}

export class Candidate {
  constructor(
    public candidate: string,
    public rate: f64
  ) {}
}

@json
export class Yields {
  constructor(
    public weeklyYieldAave: string,
    public weeklyYieldCompound: string,
    public weeklyYieldMorpho: string,
    public lastUpdatedAave: string,
    public lastUpdatedCompound: string,
    public lastUpdatedMorpho: string,
    public symbol: string
  ) {}
}

@json
export class SubgraphResponse {
  constructor(public yields: Array<Yields>) {}
}
