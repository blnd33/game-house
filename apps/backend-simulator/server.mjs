import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Simulator, ApiError } from './engine.mjs';

const api = JSON.parse(readFileSync(new URL('../../contracts/openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true }); addFormats(ajv); ajv.addKeyword({ keyword: 'discriminator', valid: true });
ajv.addSchema(JSON.parse(JSON.stringify({ $id: 'https://gaming-house.invalid/api', $defs: api.components.schemas }).replaceAll('#/components/schemas/', '#/$defs/')));
const valid = (schema, value) => ajv.getSchema(`https://gaming-house.invalid/api#/$defs/${schema}`)(value);

export async function startSimulator(directory, port = 4317) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'simulator.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);');
  const engine = new Simulator(JSON.parse(db.prepare('SELECT payload FROM state WHERE id=1').get()?.payload ?? 'null'));
  const save = () => db.prepare('INSERT OR REPLACE INTO state VALUES(1, ?)').run(JSON.stringify(engine.data));
  const tokenPath = join(directory, 'admin-token');
  let adminToken; try { adminToken = readFileSync(tokenPath, 'utf8'); } catch { adminToken = randomBytes(32).toString('hex'); writeFileSync(tokenPath, adminToken, { mode: 0o600 }); }
  const equal = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(adminToken) && timingSafeEqual(Buffer.from(value), Buffer.from(adminToken));
  let unavailableUntil = 0;
  const server = http.createServer(async (req, res) => {
    let body = null, stationId = null, requestId = req.headers['x-request-id'] ?? randomUUID();
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      // Loopback only, no CORS and no browser Origin: dev cashier is a local CLI.
      if (req.headers.origin || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) throw new ApiError('FORBIDDEN_STATION', 403);
      if (req.method === 'POST') {
        let bytes = 0, chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 256 * 1024) throw new ApiError('INVALID_REQUEST', 400); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw new ApiError('INVALID_REQUEST', 400); }
        requestId = body.request_id ?? requestId;
      }
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (path === '/__dev' && req.method === 'POST') {
        if (!equal(req.headers['x-development-token'])) throw new ApiError('UNAUTHENTICATED', 401);
        if (body.type === 'fault') { unavailableUntil = Date.now() + Math.min(300, Math.max(0, Number(body.seconds) || 0)) * 1000; return send(200, { unavailable_until: new Date(unavailableUntil).toISOString() }); }
        const reply = engine.admin(body); save(); return send(200, reply);
      }
      if (Date.now() < unavailableUntil) throw new ApiError('TEMPORARILY_UNAVAILABLE', 503);
      const normalized = path.replace(/^\/gaming\/v1/, '');
      const match = normalized.match(/^\/stations\/([^/]+)\/(.+)$/);
      stationId = match?.[1] ?? null;
      const template = match ? `/stations/{station_id}/${match[2].startsWith('sessions/') ? 'sessions/{session_id}' : match[2]}` : normalized;
      const operation = api.paths[template]?.[req.method.toLowerCase()];
      if (!operation) throw new ApiError('INVALID_REQUEST', 400);
      const key = req.headers['idempotency-key'];
      if (req.method === 'POST') {
        const schema = operation.requestBody.content['application/json'].schema.$ref.split('/').pop();
        if (!valid(schema, body) || !valid('EnrollRequest', { api_version: '1', request_id: key, sent_at: new Date().toISOString(), pairing_code: 'shape-only', installation_id: key, agent_version: 'test', station_label: 'PC-01' })) throw new ApiError('INVALID_REQUEST', 400);
      }
      let reply;
      if (template === '/devices/enroll') reply = engine.enroll(body, key);
      else {
        const s = match[2] === 'credentials/renew' ? engine.station(stationId) : engine.authorizeToken(stationId, (req.headers.authorization ?? '').replace(/^Bearer /, ''));
        reply = engine.handle(match[2], s, body, key, requestId);
      }
      const replySchema = operation.responses['200'].content['application/json'].schema.$ref.split('/').pop();
      if (!valid(replySchema, reply)) throw new Error(`Invalid simulator response: ${replySchema}`);
      save(); send(200, reply);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      if (!(error instanceof ApiError)) console.error(error.message);
      send(status, { api_version: '1', request_id: requestId, station_id: stationId, session_id: body?.session_id ?? null, server_time: new Date().toISOString(), code: error instanceof ApiError ? error.code : 'TEMPORARILY_UNAVAILABLE', message: error instanceof ApiError ? error.code : 'Simulator failure; see development log.', retryable: status === 503, retry_after_seconds: status === 503 ? 1 : null });
    }
  });
  server.requestTimeout = 10000;
  const timer = setInterval(() => { engine.tick(); save(); }, 250); // Independent of cashier/UI and client polling.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const close = async () => { clearInterval(timer); await new Promise(resolve => server.close(resolve)); save(); db.close(); };
  return { engine, port: server.address().port, close };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startSimulator(resolve(process.env.GH_SIM_DATA ?? 'artifacts/simulator'));
  console.log(`Development simulator: http://127.0.0.1:${server.port}/gaming/v1 (no production access)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close().then(() => process.exit()));
}
