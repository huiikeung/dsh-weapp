'use strict';
// Local-only disposable visual preview. Never uses production state or WeChat credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService } = require('../server.cjs');
const port = Number(process.env.PREVIEW_PORT || 18790);
const origin = 'http://127.0.0.1:' + port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-console-visual-'));
const setup = crypto.randomBytes(32).toString('hex');
const server = createService({ stateFile: path.join(dir, 'state.json'),
  exchangeCode: async () => 'visual-test-user-only',
  consoleOptions: { origin, setupToken: setup, masterKey: crypto.randomBytes(32).toString('hex') } });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); });
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.listen(port, '127.0.0.1', async () => {
  try {
    const res = await fetch(origin + '/console/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ setupToken: setup, password: 'visual-preview-only-2026' }) });
    if (!res.ok) throw new Error('Preview setup failed');
    console.log('Disposable preview ready at ' + origin + '; fixture password is defined only in test/preview.cjs');
  } catch { console.error('Preview setup failed'); stop(); }
});
setTimeout(stop, 20 * 60 * 1000).unref();
