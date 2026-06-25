import { Chains, Client, EthersSigner, TriggerType } from "@mimicprotocol/sdk";

import { keccak256, toUtf8Bytes, Wallet } from "ethers";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env file");

  const signer = EthersSigner.fromPrivateKey(PRIVATE_KEY);
  const client = new Client({ signer });

  const settler = "0x609d831C0068844e11eF85a273c7F356212Fd6D1".toLowerCase()
  const topic0 = '0xee2c98c99b683f71058b8744fea294a411482f07d55c98b392917e9286f22f13' // IntentExecuted
  const topic1 = '' // user Smart account now this can be 0
  const topicDepositSucceeded = keccak256(
    toUtf8Bytes("DepositRequestSucceeded(uint256)")
  );

  const trigger = {
    type: TriggerType.Event as const,
    chainId: Chains.Base,
    contract: settler,
    topics : [
            [topic0],
            [],
            [topicDepositSucceeded]
        ],
    delta: "5m",
    endDate: 0, // 0 means no end date. Remember to deactivate it manually from the explorer
  };

  const input = {
    chainId: 8453,
    USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    smartAccount: "0xcc9edebe999cd31a2345c385f3a8f05ff9b421f2",
    aUSDC: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
    aavePool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
    morphoVault: "0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a",
    cUSDC: "0xb125e6687d4313864e53df431d5425969c15eb2f",
    threshold: 1,
    feeAmount: 1,
    subgraphId: "CkVeaqhi287jzHGAUTHJwUk89WnznTH6w774jJT491Ce",
  };

  
  const cid = "QmXuoGATTa1REDTDTYCrBFBUW5KDLTpkrS7WZCY9on3VDY";
  const manifest = await client.tasks.getManifest(cid);
  const params = {
    //get this from /build in the deployed function
    taskCid: cid,
    description: "Settle investment function",
    input,
    trigger,
    version: "0.0.16",
    manifest,
    signer: new Wallet(PRIVATE_KEY).address,
    executionFeeLimit: "0",
    minValidations: 1,
  };

  await client.configs.signAndCreate(params);
}

main().catch((err) => console.error("❌ Error:", JSON.stringify(err, null ,2)));