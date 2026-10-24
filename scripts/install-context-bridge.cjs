// Installs the context-dashboard bridge into a deployed mobile gateway package
// (dsh-plugin-mobile-gateway or dsh-plugin-weapp-gateway).
//
// The bridge registers the `mobileContext` session projection and serves
// { type: 'context-dashboard', sessionId } -> { kind: 'context-dashboard', ... }
// for the mini program's 「上下文」 tab. Restart DSH after installing so the
// gateway loads the patched module.
//
// Usage: node scripts/install-context-bridge.cjs <absolute gateway package> [--check]
const fs = require('node:fs');
const path = require('node:path');

function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Unsupported gateway source; nothing changed: ' + before.slice(0, 80));
  return source.replace(before, after);
}

function has(source, marker) {
  return source.includes(marker);
}

function transform(source) {
  // 1. Import the bridge module next to the plugin-management import (both
  //    gateway packages ship it; the weapp fork also has workspace changes).
  const oldImport = "import { handleContextQuery, registerContextProjection, CONTEXT_REQUEST_TYPES } from './context-bridge.mjs'";
  const fleetImport = "import { handleContextQuery, handleContextFleet, registerContextProjection, registerContextServices, CONTEXT_REQUEST_TYPES } from './context-bridge.mjs'";
  const newImport = "import { handleContextQuery, handleContextFleet, handleContextContent, handleContextInsights, handleContextComms, registerContextProjection, registerContextServices, CONTEXT_REQUEST_TYPES } from './context-bridge.mjs'";
  if (source.includes(oldImport)) {
    source = source.replace(oldImport, newImport);
  } else if (source.includes(fleetImport)) {
    source = source.replace(fleetImport, newImport);
  } else if (!source.includes(newImport)) {
    const importAfter = has(source, "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'")
      ? "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'"
      : "import { handlePluginQuery, PLUGIN_REQUEST_TYPES } from './plugin-management.mjs'";
    source = once(source, importAfter, importAfter + "\n" + newImport);
  }

  // 1b. Older installs already imported the bridge without the newest handlers:
  //     rewrite that import so the dispatch lines below resolve.
  if (!source.includes('handleContextInsights') || !source.includes('handleContextComms')) {
    source = source.replace(/import \{ handleContextQuery[^}]*\} from '\.\/context-bridge\.mjs'/, newImport);
  }

  // 1c. A partial earlier install can leave TWO bridge imports behind; ES
  //     modules reject duplicate bindings, so the plugin would fail to boot.
  //     Collapse them into one canonical import at the first position.
  const bridgeImportRe = /^import \{[^}]*\} from '\.\/context-bridge\.mjs'\r?$/gm;
  const bridgeImports = source.match(bridgeImportRe);
  if (bridgeImports && bridgeImports.length > 1) {
    let kept = false;
    source = source.replace(bridgeImportRe, () => {
      if (kept) return '';
      kept = true;
      return newImport;
    });
    source = source.replace(/\n{3,}/g, '\n\n');
  }

  // 2. Dispatch the new request type from handleQuery.
  if (!source.includes('context-fleet')) {
    const contextDispatch = '  if (CONTEXT_REQUEST_TYPES.has(msg.type)) return handleContextQuery(api, msg)';
    if (source.includes(contextDispatch)) {
      source = source.replace(contextDispatch,
        "  if (msg.type === 'context-fleet') return handleContextFleet(msg)\n" + contextDispatch);
    } else {
      const dispatchAfter = has(source, '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)')
        ? '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)'
        : '  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)';
      source = once(source, dispatchAfter,
        dispatchAfter + "\n  if (msg.type === 'context-fleet') return handleContextFleet(msg)"
        + '\n  if (CONTEXT_REQUEST_TYPES.has(msg.type)) return handleContextQuery(api, msg)');
    }
  }
  if (!source.includes("msg.type === 'context-content'")) {
    const fleetDispatch = "  if (msg.type === 'context-fleet') return handleContextFleet(msg)";
    source = once(source, fleetDispatch,
      fleetDispatch + "\n  if (msg.type === 'context-content') return handleContextContent(api, msg)");
  }
  if (!source.includes("msg.type === 'context-insights'")) {
    const contentDispatch = "  if (msg.type === 'context-content') return handleContextContent(api, msg)";
    source = once(source, contentDispatch,
      contentDispatch + "\n  if (msg.type === 'context-insights') return handleContextInsights(msg)");
  }
  if (!source.includes("msg.type === 'context-comms'")) {
    const insightsDispatch = "  if (msg.type === 'context-insights') return handleContextInsights(msg)";
    const contentDispatch = "  if (msg.type === 'context-content') return handleContextContent(api, msg)";
    const fleetDispatch = "  if (msg.type === 'context-fleet') return handleContextFleet(msg)";
    const anchor = source.includes(insightsDispatch) ? insightsDispatch : (source.includes(contentDispatch) ? contentDispatch : fleetDispatch);
    source = once(source, anchor, anchor + "\n  if (msg.type === 'context-comms') return handleContextComms(api, msg)");
  }

  // 3. Register the projection once the plugin context (and its optional
  //    sessionProjections service) is available. Old hosts skip registration,
  //    and the query then answers context-unavailable.
  const apiAnchors = [
    '    const api = createDshHostAdapter(ctx.typertGateway, peer)',
    '    const api = createDshHostAdapter(ctx.typertGateway)',
  ];
  const apiAnchor = apiAnchors.find(anchor => has(source, anchor));
  if (!apiAnchor) throw Error('Unsupported gateway source: host adapter creation not found');
  if (!source.includes('registerContextServices(ctx)')) {
    const projectionRegistration = '    registerContextProjection(ctx)';
    if (source.includes(projectionRegistration)) {
      // A previous install already registered the projection: append the services.
      source = once(source, projectionRegistration,
        projectionRegistration + '\n    registerContextServices(ctx)');
    } else {
      // Fresh install: register both after the host adapter is created.
      source = once(source, apiAnchor,
        apiAnchor + '\n    // Optional lifecycle-bound services: hosts without session projections keep working.\n'
        + '    registerContextProjection(ctx)\n    registerContextServices(ctx)');
    }
  }

  // 4. Route the request through the paired-device whitelist. Skip when a
  //    previous install already names the request type.
  const whitelistPatched = [
    'CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {',
    'CONTEXT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {',
  ];
  if (!whitelistPatched.some(marker => source.includes(marker))) {
    const whitelistAnchors = [
      '                       ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {',
      '                       ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {',
      '                       PLUGIN_REQUEST_TYPES.has(msg.type)) {',
    ];
    const whitelistAnchor = whitelistAnchors.find(anchor => has(source, anchor));
    if (!whitelistAnchor) throw Error('Unsupported gateway source: request whitelist not found');
    source = once(source, whitelistAnchor, whitelistAnchor.replace('PLUGIN_REQUEST_TYPES.has(msg.type)) {', 'CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {'));
  }

  // 5. Require a paired device for the new request, like plugin management.
  //    Variant A (weapp fork) already wraps the whole condition; variant B
  //    (upstream mobile gateway) needs the inserted group parenthesised.
  const authPatched = [
    "if ((CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {",
    "if ((COST_METER_REQUEST_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {",
    "CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {",
  ].some(marker => source.includes(marker));
  const buggyAuth = 'if (CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) && !ws.deviceId) {';
  if (!authPatched && source.includes(buggyAuth)) {
    // Repair an install made before the operator-precedence fix.
    source = source.replace(buggyAuth, 'if ((CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {');
  } else if (!authPatched) {
    const authAnchors = [
      "              if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {",
      '              if (PLUGIN_REQUEST_TYPES.has(msg.type) && !ws.deviceId) {',
    ];
    const authAnchor = authAnchors.find(anchor => has(source, anchor));
    if (!authAnchor) throw Error('Unsupported gateway source: device auth check not found');
    if (authAnchor.includes("msg.type === 'clawbot-control'")) {
      source = once(source, authAnchor, authAnchor.replace('PLUGIN_REQUEST_TYPES.has(msg.type)', 'CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)'));
    } else {
      source = once(source, authAnchor, authAnchor.replace('PLUGIN_REQUEST_TYPES.has(msg.type)', '(CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type))'));
    }
  }

  // 6. Advertise the capability so clients can hide the tab without a probe.
  const capabilityAnchors = [
    "              ...(options.fileDownloadsEnabled ? ['file-downloads', 'file-references-v1'] : []),",
    "              ...(api.account ? ['account-v1'] : []),",
    "              ...(api.workspaceChanges ? ['workspace-changes-v1'] : []),",
  ];
  const capabilityAnchor = capabilityAnchors.find(anchor => has(source, anchor));
  if (!capabilityAnchor) throw Error('Unsupported gateway source: hello capabilities not found');
  if (!source.includes("'context-dashboard-v1'")) {
    source = once(source, capabilityAnchor, capabilityAnchor + "\n              'context-dashboard-v1',");
  }
  if (!source.includes("'context-fleet-v1'")) {
    source = once(source, "              'context-dashboard-v1',",
      "              'context-dashboard-v1',\n              'context-fleet-v1',");
  }
  if (!source.includes("'context-content-v1'")) {
    source = once(source, "              'context-fleet-v1',",
      "              'context-fleet-v1',\n              'context-content-v1',");
  }
  // 洞察页/通讯面板也要能发现能力，否则客户端会一直显示「需升级网关」。
  if (!source.includes("'context-insights-v1'")) {
    source = once(source, "              'context-content-v1',",
      "              'context-content-v1',\n              'context-insights-v1',");
  }
  if (!source.includes("'context-comms-v1'")) {
    source = once(source, "              'context-insights-v1',",
      "              'context-insights-v1',\n              'context-comms-v1',");
  }

  return source;
}

function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway');
  const index = path.join(root, 'lib/index.mjs'), bridge = path.join(root, 'lib/context-bridge.mjs');
  const original = fs.readFileSync(index, 'utf8'), updated = transform(original);
  const previousBridge = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : null;
  const nextBridge = fs.readFileSync(path.join(__dirname, 'lib', 'context-bridge.mjs'), 'utf8');
  const changes = (original !== updated ? 1 : 0) + (previousBridge !== nextBridge ? 1 : 0);
  if (checkOnly) return { compatible: true, changes };
  if (!changes) return { updated: 0, restartRequired: false };
  const stamp = Date.now();
  fs.writeFileSync(index + '.before-context-' + stamp, original, { flag: 'wx' });
  if (previousBridge !== null) fs.writeFileSync(bridge + '.before-context-' + stamp, previousBridge, { flag: 'wx' });
  try { fs.writeFileSync(bridge, nextBridge); fs.writeFileSync(index, updated); }
  catch (error) {
    fs.writeFileSync(index, original);
    if (previousBridge !== null) fs.writeFileSync(bridge, previousBridge); else if (fs.existsSync(bridge)) fs.unlinkSync(bridge);
    throw error;
  }
  return { updated: changes, restartRequired: true };
}

if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { transform, install };
