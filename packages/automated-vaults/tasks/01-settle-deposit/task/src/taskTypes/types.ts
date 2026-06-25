import { BigInt } from '@mimicprotocol/lib-ts'

import { ERC20 } from '../types/ERC20'

export class CurrentInvestment {
  constructor(
    public token: ERC20,
    public amount: BigInt
  ) {}
}

@json
class VaultTotals {
  constructor(public net: string) {}
}

@json
export class VaultTotalsResponse {
  constructor(public vaultTotals: VaultTotals[]) {}
}
