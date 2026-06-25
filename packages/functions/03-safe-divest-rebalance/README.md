# Safe divestment rebalance task

This task runs from mimic cron, that's why it's not event triggered. If it detects that the balance is not invested in the protocol who is actually giving more APY it withdraws the funds, and emits an event `RedeemMorpho(uint256)` |`RedeemCompound(uint256)` | `RedeemAave(uint256)`, that will be caught by  `safe-investmen-task`.
This has been made in two sepparate tasks, because we are not sure about how much will we get from the withdraw.
