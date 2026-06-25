# Settle deposit task

Is the initial task, is triggered every time the vault emits an event `DepositRequest`.
It querys the subgraph to get the net amount of the total deposits. If redeems are bigger than the deposit requests, it analyzes where are the funds investend and withdraws necessary funds.

Then it executes the seettle deposit call and emits an event `DepositRequestSucceeded(uint256)` that will trigger the task `settle-investment`
