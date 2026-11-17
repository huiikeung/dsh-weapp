import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/main/ets/protocol/RequestCorrelation.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const context = {};
runInNewContext(stripTypeScriptTypes(source) + ';globalThis.match = matchesResponse;', context);
const match = context.match;
const req = { id: 'r1', matchType: 'file-download-chunk', hasRequestId: true,
  requestType: 'file-download-read', transferId: 't1', offset: 64, rpcId: '', sessionId: '' };
test('matching request ID and kind resolves', () => {
  assert.equal(match(req, { kind: 'file-download-chunk', requestId: 'r1' }), true);
  assert.equal(match(req, { kind: 'file-download-chunk', requestId: 'r2', transferId: 't1', offset: 64 }), false);
  assert.equal(match(req, { kind: 'sent', requestId: 'r1' }), false);
});
test('prompt replies require the matching RPC and session', () => {
  const prompt = { ...req, hasRequestId: false, matchType: 'question-response', rpcId: 'q1', sessionId: 's1' };
  assert.equal(match(prompt, { kind: 'question-response', rpcId: 'q1', sessionId: 's1' }), true);
  assert.equal(match(prompt, { kind: 'question-response', rpcId: 'q2', sessionId: 's1' }), false);
  assert.equal(match(prompt, { kind: 'question-response', rpcId: 'q1', sessionId: 's2' }), false);
  assert.equal(match(prompt, { kind: 'question-response' }), false);
});
test('legacy chunks require transfer and exact offset', () => {
  assert.equal(match(req, { kind: 'file-download-chunk', transferId: 't1', offset: 64 }), true);
  assert.equal(match(req, { kind: 'file-download-chunk', transferId: 't2', offset: 64 }), false);
  assert.equal(match(req, { kind: 'file-download-chunk', transferId: 't1', offset: 0 }), false);
  assert.equal(match(req, { kind: 'file-download-chunk', offset: 64 }), false);
});
test('uncorrelated upload and open responses are rejected', () => {
  assert.equal(match({ ...req, requestType: 'file-upload-chunk', matchType: 'file-upload-chunk-accepted' },
    { kind: 'file-upload-chunk-accepted', transferId: 't1', offset: 64 }), false);
  assert.equal(match({ ...req, requestType: 'file-download-open', matchType: 'file-download-opened', transferId: '' },
    { kind: 'file-download-opened' }), false);
});
test('legacy errors match only their download operation', () => {
  assert.equal(match(req, { kind: 'error', requestType: 'file-download-read' }), true);
  assert.equal(match(req, { kind: 'error', requestType: 'file-download-open' }), false);
});
