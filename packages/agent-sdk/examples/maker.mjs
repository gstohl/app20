import { runMaker } from '@app20/agent-sdk';
const [configFile, command = 'check'] = process.argv.slice(2);
if (!configFile) throw new Error('Usage: node maker.mjs operator.json [check|register|fund|run|withdraw|deactivate|release|reconcile]');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const result = await runMaker({ configFile, command, signingKey: process.env.APP20_MAKER_SIGNING_KEY, transportKeyFile: process.env.APP20_MAKER_TRANSPORT_FILE, signal: controller.signal });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
