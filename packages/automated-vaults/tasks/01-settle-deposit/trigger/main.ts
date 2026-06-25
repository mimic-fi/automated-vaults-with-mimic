import { Chains, Client, EthersSigner, TriggerType } from "@mimicprotocol/sdk";

import { keccak256, toUtf8Bytes, Wallet } from "ethers";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env file");

  const signer = EthersSigner.fromPrivateKey(PRIVATE_KEY);
  const client = new Client({ signer });

  const vault = "0xd040D117ecBfC23562dcCE155924f8892a36DDeB".toLowerCase();

  const topicDeposit = keccak256(
    toUtf8Bytes("DepositRequest(address,address,uint256,address,uint256)")
  );

  const trigger = {
    type: TriggerType.Event as const,
    chainId: Chains.Base,
    contract: vault,
    topics: [[topicDeposit]],
    delta: "5m",
    endDate: 0, // 0 means no end date. Remember to deactivate it manually from the explorer
  };

  const input = {
    chainAnalysisAddress: "0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B",
    chainId: 8453,
    smartAccount: "0xcc9edebe999cd31a2345c385f3a8f05ff9b421f2",
    feeAmount: 1,
    vaultAddress: vault,
    aUSDC: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
    cUSDC: "0xb125e6687d4313864e53df431d5425969c15eb2f",
    morphoVault: "0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a",
    aavePool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
    USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    subgraphId: "CkVeaqhi287jzHGAUTHJwUk89WnznTH6w774jJT491Ce",
  };

  
  const cid = "QmWJsDeg9k9wGWQEYaczhKV9bZwPihBLJ9BGzvosNZgDW7";
  const manifest = await client.tasks.getManifest(cid);
  const params = {
    //get this from /build in the deployed task
    taskCid: cid,
    description: "Settle deposit event triggered",
    input,
    trigger,
    version: "0.0.15",
    manifest,
    signer: new Wallet(PRIVATE_KEY).address,
    executionFeeLimit: "0",
    minValidations: 1,
  };
  await client.configs.signAndCreate(params);
}

main().catch((err) => console.error("❌ Error:", JSON.stringify(err, null, 2)));
