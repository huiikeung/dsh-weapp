'use strict';
const { t: uiText } = require('./ui-preferences');
const util = require('./util');
const ACTIVE = ['installing', 'cancelling', 'applying', 'unconfirmed'];
const OWNED_TYPES = ['plugin-registries', 'plugin-inspect', 'plugin-inspection', 'plugin-install',
  'plugin-install-result', 'plugin-install-state', 'plugin-install-log', 'plugin-install-status', 'plugin-install-cancel'];

function message(error) {
  const text = error && (error.message || error.diagnostic || error.code) || String(error || uiText('插件操作失败'));
  return /unknown message type|not supported/i.test(text)
    ? uiText('当前网关不支持添加插件，请升级移动网关后重试') : text;
}

// Tasks belong to the connected Host, and survive page close/reopen and reconnects.
function createInstaller(deps) {
  const tasks = new Map();
  const storageKey = 'dsh_plugin_install_tasks_v1';
  try {
    const saved = has.getStorageSync(storageKey);
    if (Array.isArray(saved)) saved.forEach(item => {
      if (item && typeof item.owner === 'string' && typeof item.installId === 'string') {
        tasks.set(item.owner, { owner: item.owner, installId: item.installId, spec: item.spec || '',
          phase: 'unconfirmed', message: uiText('检测到尚未确认的安装任务，请连接原主机核对状态'), logs: '', pendingBuilds: [] });
      }
    });
  } catch (e) { /* Storage can be unavailable in restricted environments. */ }
  function persist() {
    try {
      has.setStorageSync(storageKey, Array.from(tasks.values()).filter(t => t.installId && ACTIVE.includes(t.phase))
        .map(t => ({ owner: t.owner, installId: t.installId, spec: t.spec })));
    } catch (e) { /* Keep in-memory recovery if storage is full. */ }
  }
  const owner = () => deps.state.activeID || deps.state.gatewayId || deps.state.endpoint || '';
  const current = () => tasks.get(owner()) || null;
  function publish(task) {
    persist();
    if (!task || task.owner === owner()) {
      deps.state.pluginInstall = task || current();
      deps.emit();
    }
  }
  function assertManage() {
    if (deps.state.connection !== 'connected') throw new Error(uiText('连接网关后才能添加插件'));
    if (!deps.state.pluginCatalog || !deps.state.pluginCatalog.managementAvailable) throw new Error(uiText('当前 Host 不支持插件管理'));
    if (deps.state.pluginPendingName) throw new Error(uiText('另一个插件操作尚未结束，请稍后重试'));
  }
  function owns(task) { return tasks.get(task.owner) === task; }
  function uncertain(task, error) {
    if (!owns(task) || !ACTIVE.includes(task.phase)) return;
    task.phase = 'unconfirmed';
    task.message = uiText('安装结果待确认，请重连后核对安装状态，勿重复安装。') + message(error);
    publish(task);
  }
  function settle(task, result) {
    if (!owns(task) || !ACTIVE.includes(task.phase)) return;
    if (!result) {
      task.phase = 'unknown';
      task.message = uiText('主机没有此安装记录，请先刷新插件列表确认，再重新添加。');
    } else {
      task.result = result;
      task.pendingBuilds = (Array.isArray(result.pendingBuilds) ? result.pendingBuilds : []).filter(x => typeof x === 'string');
      task.bundle = result.bundle || (task.subject && task.subject.name) || '';
      const app = result.application;
      task.phase = app === 'failed' ? 'failed' : app === 'cancelled' ? 'cancelled'
        : ['applied', 'restart-required', 'overridden'].includes(app) ? 'done' : 'unconfirmed';
      task.message = app === 'applied' ? uiText('插件已安装') + (task.enabled ? uiText('并启用') : uiText('，可在列表中启用'))
        : app === 'restart-required' ? uiText('插件已安装，请重启 DSH 后刷新目录')
        : app === 'overridden' ? uiText('设置已保存，但被其他配置覆盖，请检查 DSH 配置')
        : app === 'cancelled' ? uiText('已取消安装，下载的文件可能保留')
        : app === 'failed' ? message(result.error || uiText('插件安装失败')) : uiText('无法确认安装结果，请刷新目录核对');
      if (task.pendingBuilds.length) task.message += uiText('；部分依赖需要明确授权运行安装脚本。');
    }
    publish(task);
    if (task.owner === owner() && deps.state.connection === 'connected') deps.refresh();
  }
  async function run(task, approvedBuilds) {
    assertManage();
    if (task.catalogName) {
      const bundle = (deps.state.pluginCatalog.bundles || []).find(b => b.name === task.catalogName);
      if (!bundle || !bundle.isOfficial || bundle.readOnlyReason || !bundle.installTarget || bundle.installTarget.spec !== task.spec) {
        throw new Error(uiText('官方插件安装目标已变化，请刷新目录后重新打开开关'));
      }
      if (bundle.availability !== 'missing') throw new Error(uiText('插件已可用，请刷新目录后直接启用'));
    }
    task.installId = util.uuid();
    task.phase = 'installing';
    task.message = uiText('正在准备安装…');
    task.logs = '';
    task.pendingBuilds = [];
    task.recovering = false;
    task.cancelling = false;
    tasks.set(task.owner, task);
    publish(task);
    const payload = { requestId: task.installId, spec: task.spec, enabled: task.enabled };
    if (task.registry !== undefined) payload.registry = task.registry;
    if (approvedBuilds && approvedBuilds.length) payload.approvedBuilds = approvedBuilds;
    try { settle(task, (await deps.client.requestPlugin('plugin-install', payload, 600000)).result); }
    catch (error) { uncertain(task, error); }
  }
  async function reconcile() {
    const task = current();
    if (!task || !task.installId || !ACTIVE.includes(task.phase) || task.recovering || deps.state.connection !== 'connected') return;
    task.recovering = true; publish(task);
    try { settle(task, (await deps.client.requestPlugin('plugin-install-status', { installId: task.installId }, 600000)).result); }
    catch (error) { uncertain(task, error); }
    finally { task.recovering = false; if (owns(task)) publish(task); }
  }
  return {
    async registries() { assertManage(); return deps.client.requestPlugin('plugin-registries'); },
    prepareOfficial(name, registry) {
      assertManage();
      const existing = current();
      if (existing && (ACTIVE.includes(existing.phase) || existing.phase === 'checking')) throw new Error(uiText('已有安装任务，请先核对状态'));
      const bundle = (deps.state.pluginCatalog.bundles || []).find(b => b.name === name);
      if (!bundle || !bundle.isOfficial || bundle.availability !== 'missing' || bundle.readOnlyReason) throw new Error(uiText('当前插件不能按需安装，请刷新目录'));
      const target = bundle.installTarget;
      if (!target || !target.spec.trim()) throw new Error(uiText('主机未提供兼容版本的安装目标，请升级 DSH 或移动网关后重试'));
      if (registry !== undefined && registry !== null && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(registry)) throw new Error(uiText('安装源需为有效的 HTTP(S) 地址'));
      // Desktop trusts the Host catalog target; ordinary inspect can refuse an official catalog entry.
      const task = { owner: owner(), catalogName: name, spec: target.spec, registry, enabled: true,
        subject: { status: 'accepted', name, version: target.version, selection: true },
        phase: 'ready', message: uiText('此插件需要先安装；将安装与当前 DSH 匹配的版本并启用'), logs: '', pendingBuilds: [] };
      tasks.set(task.owner, task); publish(task);
    },
    async inspect(spec, registry) {
      assertManage();
      if (current() && (ACTIVE.includes(current().phase) || current().phase === 'checking')) throw new Error(uiText('已有安装任务，请先核对状态'));
      spec = String(spec || '').trim();
      if (!spec || spec.length > 512) throw new Error(uiText('请输入有效的包名、Git 地址或主机目录（最多 512 字符）'));
      if (registry !== undefined && registry !== null && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(registry)) throw new Error(uiText('安装源需为有效的 HTTP(S) 地址'));
      const task = { owner: owner(), spec, registry, phase: 'checking', message: uiText('正在检查插件…'), logs: '', pendingBuilds: [] };
      tasks.set(task.owner, task); publish(task);
      try {
        const payload = { spec };
        if (registry !== undefined) payload.registry = registry;
        const response = await deps.client.requestPlugin('plugin-inspect', payload);
        if (!owns(task) || task.phase !== 'checking') return;
        const result = response.result;
        if (!result || result.status !== 'accepted') {
          const labels = { 'already-installed': uiText('该插件已安装，如需升级请先在 DSH 中卸载'), shipped: uiText('该插件随 DSH 提供，请升级 DSH'),
            'not-found': uiText('未找到该插件'), 'not-package': uiText('路径不存在或不是有效的插件包'), 'not-bundle': uiText('该包没有声明 DSH 插件组合包'),
            network: uiText('无法连接插件源，请检查主机网络或更换安装源'), invalid: uiText('无法识别包名或地址') };
          throw new Error((result && labels[result.problem] || uiText('无法安装此插件')) + (result && result.reason ? '：' + result.reason : ''));
        }
        task.subject = result;
        // Use the registry that the Host actually inspected (including fallback).
        if (Object.prototype.hasOwnProperty.call(result, 'registry')) task.registry = result.registry;
        task.phase = 'ready'; task.message = uiText('检查通过，请确认插件来源后安装'); publish(task);
      } catch (error) {
        if (owns(task) && task.phase === 'checking') { task.phase = 'failed'; task.message = message(error); publish(task); }
      }
    },
    start(enabled) {
      const task = current();
      if (!task || task.phase !== 'ready') return Promise.resolve();
      task.enabled = enabled === true;
      return run(task);
    },
    approveBuilds(names) {
      const task = current();
      if (!task || task.phase !== 'failed' || !task.pendingBuilds.length) return Promise.resolve();
      if (!Array.isArray(names) || names.length !== task.pendingBuilds.length || names.some(n => !task.pendingBuilds.includes(n))) throw new Error(uiText('请明确批准列出的安装脚本'));
      return run(Object.assign({}, task), names.slice());
    },
    async cancel() {
      const task = current();
      if (!task || !task.installId || !ACTIVE.includes(task.phase) || task.cancelling || deps.state.connection !== 'connected') return;
      task.cancelling = true; publish(task);
      try {
        const result = (await deps.client.requestPlugin('plugin-install-cancel', { installId: task.installId })).result;
        if (!owns(task) || !ACTIVE.includes(task.phase)) return;
        task.message = result && result.status === 'too-late' ? uiText('安装已进入收尾阶段，无法取消，请等待最终结果') : uiText('取消请求已发送，正在核对最终结果');
        if (result && result.status === 'cancelled') task.phase = 'cancelling';
        publish(task);
        reconcile();
      } catch (error) { if (owns(task) && ACTIVE.includes(task.phase)) { task.message = uiText('取消尚未确认：') + message(error); publish(task); } }
      finally { task.cancelling = false; if (owns(task)) publish(task); }
    },
    reset() {
      const task = current();
      if (task && ACTIVE.includes(task.phase)) return false;
      tasks.delete(owner()); persist(); deps.state.pluginInstall = null; deps.emit(); return true;
    },
    reconcile,
    connectionChanged(status) {
      const task = current();
      deps.state.pluginInstall = task;
      if (!task) return;
      if (status !== 'connected') {
        if (ACTIVE.includes(task.phase)) uncertain(task, uiText('连接已断开'));
        else if (task.phase === 'checking' || task.phase === 'ready') { task.phase = 'failed'; task.message = uiText('连接已变化，请重新检查插件'); publish(task); }
      } else if (task.phase === 'unconfirmed') reconcile();
    },
    handle(frame) {
      if (!OWNED_TYPES.includes(frame.kind) && !(frame.kind === 'error' && OWNED_TYPES.includes(frame.requestType))) return false;
      const task = current();
      if (!task || frame.requestId !== task.installId || !ACTIVE.includes(task.phase)) return true;
      if (frame.kind === 'plugin-install-state') {
        if (['installing', 'cancelling', 'applying'].includes(frame.phase)) task.phase = frame.phase;
        task.message = { installing: uiText('正在下载并安装插件…'), cancelling: uiText('正在取消安装…'), applying: uiText('正在应用插件配置…') }[task.phase] || task.message;
        if (frame.attempt) task.message += uiText('（安装源 ') + frame.attempt.index + '/' + frame.attempt.total + '）';
        publish(task);
      } else if (frame.kind === 'plugin-install-log') {
        task.logs = (task.logs + String(frame.text || '')).slice(-16000); publish(task);
      } else if (frame.kind === 'plugin-install-result') settle(task, frame.result);
      return true;
    }
  };
}
module.exports = { createInstaller, ACTIVE };
