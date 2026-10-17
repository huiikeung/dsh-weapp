const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('../utils/protocol');

const expected = {
  read_file: 'dsh-read.svg',
  grep: 'dsh-search.svg',
  bash: 'dsh-bash.svg',
  apply_patch: 'dsh-edit.svg',
  custom_agent_tool: 'dsh-process-tool.svg'
};

Object.entries(expected).forEach(([name, iconFile], seq) => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'assets', 'icons', iconFile)), true, iconFile);
  const aggregator = protocol.newAggregator();
  protocol.applyEvent(aggregator, {
    sessionId: 'icons-test',
    seq,
    event: { type: 'tool/call', callId: 'call-' + seq, name, arguments: {} }
  });
  assert.equal(aggregator.rows[0].tools[0].iconFile, iconFile, name);
});

const failedAggregator = protocol.newAggregator();
protocol.applyEvent(failedAggregator, {
  sessionId: 'icons-test',
  seq: 10,
  event: { type: 'tool/call', callId: 'call-failed', name: 'grep', arguments: {} }
});
protocol.applyEvent(failedAggregator, {
  sessionId: 'icons-test',
  seq: 11,
  event: { type: 'tool/result', callId: 'call-failed', isError: true, preview: 'failed' }
});
assert.equal(failedAggregator.rows[0].tools[0].iconFile, 'dsh-search.svg');
assert.equal(failedAggregator.rows[0].tools[0].isError, true);

console.log('DSH tool icon mapping: PASS');
