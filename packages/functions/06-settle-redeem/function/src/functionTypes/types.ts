import { Address, BigInt } from '@mimicprotocol/lib-ts'

import { ERC20 } from '../types/ERC20'

@json
class VaultTotals {
  constructor(public net: string) {}
}
@json
export class VaultTotalsResponse {
  constructor(public vaultTotals: VaultTotals[]) {}
}

export class CurrentInvestment {
  constructor(
    public token: ERC20,
    public amount: BigInt
  ) {}
}

export class RedeemRequest {
  constructor(
    public controller: Address,
    public owner: Address,
    public shares: BigInt
  ) {}
}
