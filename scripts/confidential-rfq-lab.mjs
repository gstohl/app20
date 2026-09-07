// Development UI over the shared SDK and disposable real-pool devnet fixture.
import { createServer } from 'vite';
import { createConfidentialLab } from '../pool-harness/src/confidential-lab.mjs';

const port = Number(process.env.APP20_CONFIDENTIAL_UI_PORT ?? 5198);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid development port.');
const origin = `http://127.0.0.1:${port}`;
process.env.VITE_CONFIDENTIAL_RFQ_LAB = 'true';
process.env.RUST_LOG ??= 'warn';
let lab, bootFailed = false, busy = false;
const send = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{ name: 'app20-confidential-lab', configureServer(server) {
  server.middlewares.use('/__app20_confidential', (request, response) => {
    void (async () => {
      if (request.headers.host !== `127.0.0.1:${port}` || request.headers['sec-fetch-site'] === 'cross-site' || (request.method !== 'GET' && request.headers.origin !== origin)) return send(response, 403, { error: 'Same-origin local requests required.' });
      if (request.method === 'GET' && request.url === '/state') return send(response, 200, { ready: Boolean(lab), bootFailed, busy, simulatedProofs: true, sessions: lab ? await Promise.all([...lab.sessions.values()].map(session => session.view())) : [] });
      if (request.method !== 'POST') return send(response, 405, { error: 'Unsupported method.' });
      if (!lab || busy) return send(response, 409, { error: 'Wait for the current local operation to finish.' });
      if (request.headers['content-type'] !== 'application/json') return send(response, 415, { error: 'JSON required.' });
      let text = '';
      for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 2048) return send(response, 413, { error: 'Request too large.' }); }
      let body; try { body = JSON.parse(text); } catch { return send(response, 400, { error: 'Invalid JSON.' }); }
      if (!body || typeof body !== 'object' || busy) return send(response, 409, { error: 'Wait for the current local operation to finish.' });
      busy = true;
      try {
        if (request.url === '/session') {
          if (typeof body.amountA !== 'string' || typeof body.amountB !== 'string' || lab.sessions.size >= 8) return send(response, 400, { error: 'Two amounts and fewer than eight sessions required.' });
          const session = await lab.create({ amountA: body.amountA, amountB: body.amountB });
          return send(response, 200, await session.view());
        }
        if (request.url !== '/action' || typeof body.id !== 'string' || typeof body.action !== 'string') return send(response, 400, { error: 'Invalid local action.' });
        const session = lab.sessions.get(body.id);
        if (!session) return send(response, 404, { error: 'Unknown local session.' });
        if (['setup', 'settle', 'refundA', 'refundB'].includes(body.action)) await session.operation(body.action);
        else if (body.action === 'fundA' || body.action === 'fundB') await session.fund(body.action === 'fundA' ? 'a' : 'b');
        else if (body.action === 'expire') await session.expire();
        else if (body.action === 'reconcile') await session.client.reconcile();
        else return send(response, 400, { error: 'Unsupported local action.' });
        return send(response, 200, await session.view());
      } finally { busy = false; }
    })().catch(() => send(response, 500, { error: 'The operation did not finish. Refresh the session to check funding and recovery.' }));
  });
} }] });
await vite.listen();
console.log(`Confidential RFQ development UI: ${origin}/rfq`);
console.log('Starting disposable devnet wallets. Proof facts are simulated; no mainnet transactions.');
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await vite.close(); await lab?.close(); process.exit(0); }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
try { lab = await createConfidentialLab(); console.log('Confidential RFQ local wallets are ready.'); }
catch { bootFailed = true; console.error('Local fixture startup failed; mainnet remains unavailable.'); }
