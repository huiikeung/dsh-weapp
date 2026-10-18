'use strict';
// Server-to-server verification. This never receives DSH pairing codes or keys.
function createPublicAccessVerifier(env = process.env) {
  const required = env.RELAY_REQUIRE_PUBLIC_ACCESS === 'true';
  const secret = env.RELAY_AUTH_SECRET || '';
  const endpoint = env.RELAY_AUTH_URL || '';
  if (required) {
    const url = new URL(endpoint);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || !/^[A-Za-z0-9_-]{32,128}$/.test(secret)) throw new Error('Invalid public access verification configuration');
  }
  async function verify(token, nodeId, deviceId) {
    if (!required) return null;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('public-access-required');
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
      body: JSON.stringify({ token, nodeId, deviceId }) });
    if (response.status === 401) throw new Error('public-lease-expired');
    if (response.status === 403) throw new Error('public-access-expired');
    if (!response.ok) throw new Error('public-access-unavailable');
    const result = await response.json();
    if (result.allowed !== true || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('public-access-expired');
    return result;
  }
  return { required, verify };
}
module.exports = { createPublicAccessVerifier };
