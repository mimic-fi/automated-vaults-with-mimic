# Automated vaults

These are the six Mimic functions that automate the vault lifecycle on Base (USDC),
moving idle capital across Aave, Compound and Morpho to always chase the best APY.
Mimic handles triggering, orchestration, retries and gas; the functions only define
the strategy logic. They are chained through on-chain events and Mimic crons, as shown
in the diagram below.

![1764163102912](image/README/1764163102912.png)
