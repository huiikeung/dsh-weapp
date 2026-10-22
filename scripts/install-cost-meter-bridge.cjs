// Installs the cost meter bridge into a deployed mobile gateway. New gateways
// keep their session projection and get a dashboard wrapper; old gateways get
// the standalone bridge. Restart DSH after installing.
// Usage: node scripts/install-cost-meter-bridge.cjs <absolute gateway package> [--check]
const fs = require('node:fs');
const path = require('node:path');

function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Unsupported gateway source; nothing changed: ' + before.slice(0, 80));
  return source.replace(before, after);
}

function normalizeLineEndings(str) {
  return str.replace(/\r\n/g, '\n');
}

function findQueryRouteCondition(source) {
  const starts = /(?:^|\n)[ \t]*(?:\}[ \t]*)?(?:else[ \t]+)?if[ \t]*\(/g;
  let match;
  while ((match = starts.exec(source))) {
    const open = match.index + match[0].lastIndexOf('(');
    let depth = 1;
    let close = open + 1;
    for (; close < source.length && depth > 0; close += 1) {
      if (source[close] === '(') depth += 1;
      else if (source[close] === ')') depth -= 1;
    }
    if (depth !== 0) continue;
    const condition = source.slice(open + 1, close - 1);
    let body = close;
    while (/\s/.test(source[body] || '')) body += 1;
    if (source[body] !== '{' || !condition.includes('PLUGIN_REQUEST_TYPES.has(msg.type)')) continue;
    if (condition.includes('!ws.deviceId')) continue;
    if (!/(?:ACCOUNT_REQUEST_TYPES|WORKSPACE_CHANGES_TYPES|CONTEXT_REQUEST_TYPES)\.has\(msg\.type\)/.test(condition)) continue;
    return { start: open + 1, end: close - 1, condition };
  }
  return null;
}

function transformProjectionGateway(source) {
  source = normalizeLineEndings(source);
  if (!source.includes('registerCostMeterProjection') || !source.includes('registerCostMeterServices')) {
    throw Error('Unsupported gateway source: native cost-meter projection not found');
  }

  if (!source.includes('handleCostMeterWithDashboard')) {
    const importMatch = /^import \{[^\n]*handleCostMeter[^\n]*\} from '\.\/cost-meter-bridge\.mjs'$/m.exec(source);
    if (!importMatch) throw Error('Unsupported gateway source: native cost-meter import not found');
    const baseImport = importMatch[0].replace(/\bhandleCostMeter,\s*/, '');
    source = once(source, importMatch[0], baseImport + "\nimport { handleCostMeterWithDashboard } from './cost-meter-dashboard-bridge.mjs'");
  }

  const oldDispatch = 'if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeter(api, msg)';
  const newDispatch = 'if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeterWithDashboard(api, msg, { hostContext: pluginContext?.hostContext })';
  if (!source.includes(newDispatch)) {
    if (!source.includes(oldDispatch)) throw Error('Unsupported gateway source: native cost-meter dispatch not found');
    source = once(source, oldDispatch, newDispatch);
  }

  if (!source.includes('hostContext: ctx')) {
    const anchors = [
      /^[ \t]*clawbotService,[ \t]*$/m,
      /^[ \t]*onInstallEnd: \(requestId\) => pluginInstallOwners\.delete\(requestId\),[ \t]*$/m,
    ];
    const match = anchors.map(pattern => pattern.exec(source)).find(Boolean);
    if (!match) throw Error('Unsupported gateway source: query context not found');
    const indent = match[0].match(/^[ \t]*/)[0];
    source = once(source, match[0], match[0] + '\n' + indent + 'hostContext: ctx,');
  }

  if (!source.includes('COST_METER_REQUEST_TYPES.has(msg.type)') ||
      !source.includes("'cost-meter-v1'")) {
    throw Error('Unsupported gateway source: cost-meter route or capability is missing');
  }
  return source;
}

function transform(source) {
  source = normalizeLineEndings(source);

  // Recent gateway releases already own a durable projection implementation.
  // Wrap that implementation instead of replacing it with the older fallback.
  if (source.includes('registerCostMeterProjection') && source.includes('registerCostMeterServices')) {
    return transformProjectionGateway(source);
  }

  // 1. Import the standalone bridge alongside the other mobile query bridges.
  const importAnchors = [
    "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'",
    "import { handleContextQuery, handleContextFleet, registerContextProjection, registerContextServices, CONTEXT_REQUEST_TYPES } from './context-bridge.mjs'",
    "import { handlePluginQuery, PLUGIN_REQUEST_TYPES } from './plugin-management.mjs'",
  ];
  if (!source.includes('handleCostMeter')) {
    const importAnchor = importAnchors.find(anchor => source.includes(anchor));
    if (!importAnchor) throw Error('Unsupported gateway source: query bridge import not found');
    source = once(source, importAnchor,
      importAnchor + "\nimport { handleCostMeter, COST_METER_REQUEST_TYPES } from './cost-meter-bridge.mjs'");
  }

  // 2. Route the action through handleQuery so replies retain request correlation.
  const dispatchAnchors = [
    '  if (CONTEXT_REQUEST_TYPES.has(msg.type)) return handleContextQuery(api, msg)',
    '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)',
    '  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)',
  ];
  if (!source.includes('handleCostMeter(api, msg, { hostContext: pluginContext?.hostContext })')) {
    const oldDispatch = '  if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeter(api, msg)';
    if (source.includes(oldDispatch)) {
      source = once(source, oldDispatch,
        '  if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeter(api, msg, { hostContext: pluginContext?.hostContext })');
    } else {
    const dispatchAnchor = dispatchAnchors.find(anchor => source.includes(anchor));
    if (!dispatchAnchor) throw Error('Unsupported gateway source: query dispatch not found');
    source = once(source, dispatchAnchor,
      dispatchAnchor + '\n  if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeter(api, msg, { hostContext: pluginContext?.hostContext })');
    }
  }

  // 3. Include the request in the paired control-channel whitelist.
  const route = findQueryRouteCondition(source);
  if (!route) throw Error('Unsupported gateway source: request whitelist not found');
  if (!route.condition.includes('COST_METER_REQUEST_TYPES.has(msg.type)')) {
    const updatedCondition = route.condition.replace(
      'PLUGIN_REQUEST_TYPES.has(msg.type)',
      'COST_METER_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)');
    source = source.slice(0, route.start) + updatedCondition + source.slice(route.end);
  }

  // 4. Require a paired device, matching other control-plane queries.
  const authAnchors = [
    'if ((CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {',
    'if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {',
    'if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === \'clawbot-control\') && !ws.deviceId) {',
  ];
  const pairedCheck = /if \(\([^\n]*COST_METER_REQUEST_TYPES\.has\(msg\.type\)[^\n]*!ws\.deviceId\)/.test(source);
  if (!pairedCheck || !source.includes('hostContext: ctx')) {
    const authAnchor = authAnchors.find(anchor => source.includes(anchor));
    if (authAnchor && !pairedCheck) {
      const updatedAnchor = authAnchor.includes('ACCOUNT_REQUEST_TYPES.has(msg.type)')
        ? authAnchor.replace('ACCOUNT_REQUEST_TYPES.has(msg.type) || ', 'ACCOUNT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || ')
        : authAnchor.replace('CONTEXT_REQUEST_TYPES.has(msg.type)', 'COST_METER_REQUEST_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type)');
      source = once(source, authAnchor, updatedAnchor);
    } else if (!authAnchor && !pairedCheck) {
      throw Error('Unsupported gateway source: paired-device check not found');
    }

    // Pass the Cordis context so the native dashboard can use DSH's credential store.
    // The context and any credentials are never exposed on the mobile wire.
    if (!source.includes('hostContext: ctx')) {
      const contextAnchorWithClawbot = /^[ \t]*clawbotService,[ \t]*$/m.exec(source);
      const contextAnchor = /^[ \t]*onInstallEnd: \(requestId\) => pluginInstallOwners\.delete\(requestId\),[ \t]*$/m.exec(source);
      const match = contextAnchorWithClawbot || contextAnchor;
      if (match) {
        const indent = match[0].match(/^[ \t]*/)[0];
        source = once(source, match[0], match[0] + '\n' + indent + 'hostContext: ctx,');
      } else {
        throw Error('Unsupported gateway source: query context not found');
      }
    }
  }

  // 5. Advertise the capability so clients can identify an older gateway.
  if (!source.includes("'cost-meter-v1'")) {
    const capabilityAnchors = [
      "              'context-fleet-v1',",
      "              'context-dashboard-v1',",
      "              ...(options.fileDownloadsEnabled ? ['file-downloads', 'file-references-v1'] : []),",
      "              ...(api.account ? ['account-v1'] : []),",
      "              ...(api.workspaceChanges ? ['workspace-changes-v1'] : []),",
    ];
    const capabilityAnchor = capabilityAnchors.find(anchor => source.includes(anchor));
    if (!capabilityAnchor) throw Error('Unsupported gateway source: hello capabilities not found');
    source = once(source, capabilityAnchor, capabilityAnchor + "\n              'cost-meter-v1',");
  }

  return source;
}

function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway');
  const index = path.join(root, 'lib/index.mjs'), bridge = path.join(root, 'lib/cost-meter-bridge.mjs');
  const original = fs.readFileSync(index, 'utf8'), updated = transform(original);
  const projectionGateway = original.includes('registerCostMeterProjection') && original.includes('registerCostMeterServices');
  const targetModule = projectionGateway
    ? path.join(root, 'lib/cost-meter-dashboard-bridge.mjs')
    : bridge;
  const previousModule = fs.existsSync(targetModule) ? fs.readFileSync(targetModule, 'utf8') : null;
  const nextModule = fs.readFileSync(path.join(__dirname, 'lib', projectionGateway ? 'cost-meter-dashboard-bridge.mjs' : 'cost-meter-bridge.mjs'), 'utf8');
  const changes = (original !== updated ? 1 : 0) + (previousModule !== nextModule ? 1 : 0);
  if (checkOnly) return { compatible: true, changes };
  if (!changes) return { updated: 0, restartRequired: false };
  const stamp = Date.now();
  fs.writeFileSync(index + '.before-cost-meter-' + stamp, original, { flag: 'wx' });
  if (previousModule !== null) fs.writeFileSync(targetModule + '.before-cost-meter-' + stamp, previousModule, { flag: 'wx' });
  try { fs.writeFileSync(targetModule, nextModule); fs.writeFileSync(index, updated); }
  catch (error) {
    fs.writeFileSync(index, original);
    if (previousModule !== null) fs.writeFileSync(targetModule, previousModule); else if (fs.existsSync(targetModule)) fs.unlinkSync(targetModule);
    throw error;
  }
  return { updated: changes, restartRequired: true };
}

if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { transform, install };
