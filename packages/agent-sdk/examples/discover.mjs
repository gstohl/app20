import { App20Client } from '@app20/agent-sdk';
const app = new App20Client({ rpcUrl: process.env.STARKNET_RPC_URL });
await app.verify();
let offset = 0;
do {
  const page = await app.listMakers(offset);
  for (const maker of page.makers) console.log(JSON.stringify(maker));
  offset = page.nextOffset;
} while (offset !== undefined);
