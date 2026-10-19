const store = require('../../utils/store');
const { t } = require('../../utils/ui-preferences');
const { describe } = require('../../utils/file-deliverables');
const { validSummary, validDiff } = require('../../utils/workspace-changes');

module.exports = {
  changesContext() {
    const client = store.client;
    if (!this._changesContext || this._changesContext.client !== client ||
      this._changesContext.generation !== (client && client.connectGeneration) ||
      this._changesContext.sessionId !== store.sessionState.sessionId) {
      this._changesContext = { client, generation: client && client.connectGeneration,
        sessionId: store.sessionState.sessionId, cache: new Map(), active: 0 };
    }
    return this._changesContext;
  },
  changesCurrent(context) {
    return !this._unloaded && !this._voiceHidden && context === this._changesContext &&
      context.client === store.client && context.generation === (store.client && store.client.connectGeneration) &&
      context.sessionId === store.sessionState.sessionId;
  },
  decorateChanges(row) {
    const context = this.changesContext();
    const entry = context.cache.get(row.changeSeq);
    const summary = entry && entry.value;
    const ready = summary && validSummary(summary, row.turn);
    const files = (ready ? summary.files : row.files || []).map((file, index) => Object.assign(describe(file), {
      key: file.key || row.key + '-file-' + index, sessionId: row.sessionId, index,
      display: file.display || file.path, hasCounts: !!ready
    }));
    const supported = (store.state.gatewayCapabilities || []).includes('workspace-changes-v1');
    const state = ready ? 'ready' : row.changeSeq === undefined ? 'fallback' :
      !supported ? 'unsupported' : entry ? entry.state : 'loading';
    const title = files.length === 1 ? t('已编辑 {name}', { name: files[0].name }) :
      files.length ? t('已编辑 {count} 个文件', { count: ready ? summary.total : files.length }) : t('已编辑文件');
    return Object.assign({}, row, { files, title, hasCounts: !!ready, total: ready ? summary.total : files.length,
      added: ready ? summary.added : null, deleted: ready ? summary.deleted : null, summaryState: state,
      summaryNote: state === 'loading' ? t('正在加载文件变更…') : state === 'unsupported' ? t('更新网关后可查看完整文件变更') :
        state === 'missing' ? t('该轮变更快照已失效，仍显示已确认的编辑文件') :
        state === 'error' ? t('文件变更加载失败，点击重试') : '' });
  },
  loadChangesSummaries() {
    if (this._unloaded || this._voiceHidden || this.data.tab !== 'conversation' || store.state.connection !== 'connected' ||
      !(store.state.gatewayCapabilities || []).includes('workspace-changes-v1')) return;
    const context = this.changesContext();
    if (!context.client || typeof context.client.requestChangesSummary !== 'function') return;
    const rows = (store.sessionState.rows || []).filter(row => row.kind === 'changes' && row.changeSeq !== undefined).slice().reverse();
    for (const row of rows) {
      if (context.active >= 2) break;
      if (context.cache.has(row.changeSeq)) continue;
      context.active++; context.cache.set(row.changeSeq, { state: 'loading' });
      Promise.resolve().then(() => context.client.requestChangesSummary(row.sessionId, row.changeSeq)).then(frame => {
        if (frame.sessionId !== row.sessionId || frame.seq !== row.changeSeq) throw Error('Mismatched changes response');
        if (frame.value == null) context.cache.set(row.changeSeq, { state: 'missing' });
        else {
          if (!validSummary(frame.value, row.turn)) throw Error('Invalid change summary');
          context.cache.set(row.changeSeq, { state: 'ready', value: frame.value });
        }
      }).catch(() => { context.cache.set(row.changeSeq, { state: 'error' }); }).finally(() => {
        context.active--;
        if (this.changesCurrent(context)) this.syncFromStore({ app: store.state, session: store.sessionState });
      });
    }
  },
  retryChanges(e) {
    const row = this.data.rows.find(item => item.key === e.currentTarget.dataset.key);
    if (!row || row.summaryState !== 'error') return;
    this.changesContext().cache.delete(row.changeSeq);
    this.loadChangesSummaries();
  },
  toggleChangedFiles(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ fileExpanded: Object.assign({}, this.data.fileExpanded, { [key]: !this.data.fileExpanded[key] }) });
  },
  closeChangesDiff() { this._changesDiffRequest = null; this.setData({ changesDiff: null }); },
  async openChangedFile(e) {
    const row = this.data.rows.find(item => item.key === e.currentTarget.dataset.row);
    const index = Number(e.currentTarget.dataset.index), file = row && row.files[index];
    if (!file || row.sessionId !== store.sessionState.sessionId) return;
    if (!row.hasCounts) return this.presentFile(file, 'preview');
    const context = this.changesContext(), request = {}; this._changesDiffRequest = request;
    const current = () => this.changesCurrent(context) && this._changesDiffRequest === request;
    this.setData({ changesDiff: { title: file.display, loading: true, hunks: [] } });
    try {
      const frame = await context.client.requestChangesDiff(row.sessionId, row.changeSeq, index);
      if (!current()) return;
      if (frame.sessionId !== row.sessionId || frame.seq !== row.changeSeq || frame.index !== index) throw Error('Mismatched file diff');
      const value = frame.value;
      if (value == null) { this.setData({ changesDiff: { title: file.display, note: t('该文件的变更快照已失效') } }); return; }
      if (!validDiff(value) || value.path !== file.path) throw Error('Invalid file diff');
      let remaining = 1200, truncated = false;
      const hunks = (value.hunks || []).map((hunk, hunkIndex) => {
        const lines = hunk.lines.slice(0, remaining); remaining -= lines.length;
        if (lines.length < hunk.lines.length) truncated = true;
        return { key: hunkIndex, label: '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@',
          lines: lines.map((text, lineIndex) => ({ key: lineIndex, text, kind: text[0] === '+' ? 'add' : text[0] === '-' ? 'delete' : 'context' })) };
      }).filter(hunk => hunk.lines.length);
      this.setData({ changesDiff: { title: value.display, hunks, note: value.kind === 'binary' ? t('二进制文件已变更，无法显示文本差异') :
        value.kind === 'oversized' ? t('文件过大，无法显示文本差异') : truncated ? t('仅显示前 1200 行差异') : '' } });
    } catch (_) { if (current()) this.setData({ changesDiff: { title: file.display, note: t('文件差异加载失败，请关闭后重试') } }); }
  }
};
