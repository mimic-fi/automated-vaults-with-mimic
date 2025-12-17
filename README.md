<h1 align="center">
  <a href="https://mimic.fi">
    <img src="https://www.mimic.fi/logo.png" alt="Mimic Protocol" width="200">
  </a>
</h1>

<h4 align="center">Developer platform for blockchain apps</h4>

<p align="center">
  <a href="https://discord.mimic.fi">
    <img src="https://img.shields.io/badge/discord-join-blue" alt="Discord">
  </a>
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#scope-and-chain-support">Scope</a> •
  <a href="#setup">Setup</a> •
  <a href="#license">License</a>
</p>

---

## Overview
This repository demonstrates how to build automated DeFi vaults on Ethereum using Mimic as the execution and automation layer.

In this example, vaults execute predefined strategies such as:
- Periodic rebalancing
- Yield optimization
- Conditional execution based on market state

The application does not implement:
- Automation schedulers
- Conditional execution engines
- Multi-step transaction orchestration
- Execution retries and failure handling
- Gas management or native token funding
- RPC connections or oracle integrations

Mimic handles execution by:
- Triggering strategy execution based on defined conditions
- Coordinating multi-step transactions
- Managing retries and execution failures
- Handling gas payment and transaction submission

This allows vault implementations to focus on strategy definition while delegating automation and execution complexity to Mimic.

## Scope

Ethereum is used as the reference execution environment for this example.

Mimic supports execution across multiple chains and environments. The same vault execution model can be applied to other supported networks without changes to execution orchestration.

## Setup

To set up this project you'll need [git](https://git-scm.com) and [yarn](https://classic.yarnpkg.com) installed.

From your command line:

```bash
# Clone the repository
git clone https://github.com/mimic-fi/automated-vaults-with-mimic

# Enter the repository
cd automated-vaults-with-mimic

# Install dependencies
yarn
```

## License

MIT

---

> Website [mimic.fi](https://mimic.fi) &nbsp;&middot;&nbsp;
> Docs [docs.mimic.fi](https://docs.mimic.fi) &nbsp;&middot;&nbsp;
> GitHub [@mimic-fi](https://github.com/mimic-fi) &nbsp;&middot;&nbsp;
> Twitter [@mimicfi](https://twitter.com/mimicfi) &nbsp;&middot;&nbsp;
> Discord [mimic](https://discord.mimic.fi)
