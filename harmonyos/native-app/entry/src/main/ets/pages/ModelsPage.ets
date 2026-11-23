import { NavBackButton } from '../components/NavBackButton';
import { uiMaterial } from '@kit.ArkUI';
import { appGlassBorderColor, appGlassBlur, appGlassFill, appGlassShadow } from '../common/AppGlass';
import { GatewayClient, Logger } from 'nativecore';
import type { GatewayFrame, PluginNamespace, ProviderRow, ModelRow, DiscoveredModel } from 'nativecore';
import {
  PI_NS, buildProviderRows, parseNamespace,
  appendModelsMutation, removeModelMutation, providerRemoveMutation,
  parseDiscoveredModels, discoveredModelPayload
} from 'nativecore';

/** 推理等级可选档位（对齐 REASONING_LEVELS） */
const REASONING_LEVELS: string[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** 推理档位草稿行（对齐小程序 reasoningRows） */
interface ReasoningRowDraft {
  level: string;
  value: string;
}

/**
 * 模型管理（二级页面）：对齐小程序 pages/models/models
 * 提供商卡片 + 模型增删 + 添加模型表单。
 */
@Component
export struct ModelsPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('safeBottomVp') safeBottomStorage: number = 0;
  @State sheetVisible: boolean = false;
  @State sheetOpen: boolean = false;
  @State sheetKind: string = 'add';
  @StorageLink('defaultModel') defaultModelValue: string = '';

  @State providers: ProviderRow[] = [];
  @State expandedId: string = '';
  @State loading: boolean = true;
  @State error: string = '';
  @State hint: string = '';
  @State saving: boolean = false;

  // 添加模型表单
  @State addOpen: boolean = false;
  @State addProviderId: string = '';
  @State addProviderName: string = '';
  @State formId: string = '';
  @State formName: string = '';
  @State formContext: string = '';
  @State formMaxTokens: string = '';
  @State formText: boolean = true;
  @State formImage: boolean = false;
  @State formReasoning: boolean = false;
  @State formReasoningRows: ReasoningRowDraft[] = [];
  @State formError: string = '';

  // 获取模型（发现弹层）
  @State discoverOpen: boolean = false;
  @State discoverLoading: boolean = false;
  @State discoverError: string = '';
  /** 发现失败是因为该提供商没有内置目录：引导手动添加模型 */
  @State discoverNeedsManual: boolean = false;
  /** 删除确认弹窗 */
  @State deleteOpen: boolean = false;
  @State deleteKind: string = '';
  @State deleteProviderId: string = '';
  @State deleteProviderName: string = '';
  @State deleteModelId: string = '';
  @State deleteModelName: string = '';
  @State discoverRows: DiscoveredModel[] = [];
  @State discoverSelected: string[] = [];
  private discoverProviderId: string = '';
  private discoverProviderName: string = '';

  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

  /** 与切换主机一致的半模态材质：浅色奶白、深色通透。 */
  private sheetMaterial(): uiMaterial.Material | undefined {
    if (!this.immersiveSupported()) {
      return undefined;
    }
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THICK,
      materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
      colorInvert: true,
      applyShadow: true
    });
  }

  /** 关闭所有模型弹层（原实现自己调自己导致无限递归） */
  private closeSheets(): void {
    this.sheetOpen = false;
    this.discoverOpen = false;
    this.addOpen = false;
    this.discoverSelected = [];
  }

  private providersFrame: GatewayFrame | undefined = undefined;
  private namespace: PluginNamespace = { value: undefined, revision: -1, valid: false };
  private rawProviders: Object | undefined = undefined;

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  /** 小程序 --surface：#FFFFFF / #1C1C1E */
  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  /** 小程序 --fill */
  private fieldBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)';
  }

  /** 卡片玻璃底（与 Agent 预设弹窗卡片一致） */
  /** 卡片底 = 页面背景色（靠细描边 + 投影分层，不再用白色玻璃底） */
  private glassCardBg(): string {
    return this.pageBg();
  }

  /** 卡片玻璃描边（与 Agent 预设弹窗卡片一致） */
  /** 卡片边框 = 返回按钮同款（浅色白 90%、深色白 16%） */
  private glassEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
  }

  /** 虚线新增入口底色/描边（与预设弹窗添加卡片一致） */
  private dashBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)';
  }

  private dashEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(16,19,24,0.12)';
  }

  private providerStatusColor(status: string): string {
    if (status === 'ready' || status === 'ok') return '#34C759';
    if (status === 'empty') return '#FFAE1F';
    return '#8E8E93';
  }

  private levelLabels(): Record<string, string> {
    const labels: Record<string, string> = {
      'minimal': '最小', 'low': '低', 'medium': '中', 'high': '高', 'xhigh': '极高', 'max': '最高'
    };
    return labels;
  }

  aboutToAppear(): void {
    this.refresh();
  }

  /** 拉取 providers 帧 + llm 命名空间 */
  private refresh(): void {
    if (this.connection !== 'connected') {
      this.loading = false;
      this.error = '请先连接鲸尾 Harness';
      return;
    }
    this.loading = true;
    this.error = '';
    const client: GatewayClient = GatewayClient.get();
    client.requestProviders().then((frame: GatewayFrame) => {
      this.providersFrame = frame;
      return client.requestPluginSettings(PI_NS);
    }).then((nsFrame: GatewayFrame) => {
      this.namespace = parseNamespace(nsFrame);
      this.rebuildRows();
      this.loading = false;
    }).catch((err: Error) => {
      this.loading = false;
      this.error = err.message.length > 0 ? err.message : '无法读取模型配置';
    });
  }

  private rebuildRows(): void {
    if (this.providersFrame === undefined) {
      this.providers = [];
      return;
    }
    // 保存原始 providers 供变更使用
    const value: Object | undefined = this.namespace.value;
    this.rawProviders = value !== undefined ? (value as Record<string, Object>)['providers'] : undefined;
    const rows: ProviderRow[] = buildProviderRows(this.providersFrame, this.namespace, '', this.defaultModelValue, this.levelLabels());
    this.providers = rows;
  }

  private toggleProvider(id: string): void {
    this.expandedId = this.expandedId === id ? '' : id;
  }

  /** 通用变更：重读命名空间 → 构建 ops → 提交 → 刷新 */
  private mutate(buildOps: (freshProviders: Record<string, Object>, revision: number) => Object[] | null,
                 okHint: string,
                 onSuccess: () => void): void {
    if (this.saving) {
      return;
    }
    this.saving = true;
    this.hint = '';
    const client: GatewayClient = GatewayClient.get();
    client.requestPluginSettings(PI_NS).then((nsFrame: GatewayFrame) => {
      const ns: PluginNamespace = parseNamespace(nsFrame);
      if (!ns.valid) {
        throw new Error('当前网关未提供模型配置，请升级网关后重试。');
      }
      this.namespace = ns;
      const value: Object | undefined = ns.value;
      const providers: Object | undefined = value !== undefined ? (value as Record<string, Object>)['providers'] : undefined;
      if (providers === undefined) {
        throw new Error('当前网关未提供模型配置，请升级网关后重试。');
      }
      const ops: Object[] | null = buildOps(providers as Record<string, Object>, ns.revision);
      if (ops === null) {
        throw new Error('操作未产生变更');
      }
      return client.mutatePluginSettings(PI_NS, ns.revision, ops);
    }).then(() => {
      this.saving = false;
      this.hint = okHint;
      onSuccess();
      this.refresh();
    }).catch((err: Error) => {
      this.saving = false;
      const msg: string = err.message.length > 0 ? err.message : '保存失败，请重试';
      if (this.addOpen) {
        this.formError = msg;
      } else {
        this.hint = msg;
      }
      this.refresh();
    });
  }

  /** 删除模型 */
  private deleteModel(providerId: string, modelId: string): void {
    this.mutate((freshProviders: Record<string, Object>, revision: number) => {
      const provider: Object | undefined = freshProviders[providerId];
      if (provider === undefined) {
        return null;
      }
      const rawModels: Object | undefined = (provider as Record<string, Object>)['models'];
      const models: Object[] = rawModels !== undefined && Array.isArray(rawModels) ? rawModels as Object[] : [];
      let index: number = -1;
      for (let i = 0; i < models.length; i++) {
        const id: string = String((models[i] as Record<string, Object>)['id']);
        if (id === modelId) {
          index = i;
          break;
        }
      }
      if (index < 0) {
        return null;
      }
      return removeModelMutation(providerId, index, revision);
    }, '已删除模型「' + modelId + '」', () => {
    });
  }

  /** 删除提供商 */
  private deleteProvider(providerId: string): void {
    this.mutate((freshProviders: Record<string, Object>, revision: number) => {
      if (freshProviders[providerId] === undefined) {
        return null;
      }
      return providerRemoveMutation(providerId, revision);
    }, '已删除提供商「' + providerId + '」', () => {
      this.expandedId = '';
    });
  }

  private openDeleteProvider(provider: ProviderRow): void {
    this.deleteKind = 'provider';
    this.deleteProviderId = provider.id;
    this.deleteProviderName = provider.name;
    this.deleteModelId = '';
    this.deleteModelName = '';
    this.deleteOpen = true;
  }

  private openDeleteModel(providerId: string, providerName: string, model: ModelRow): void {
    this.deleteKind = 'model';
    this.deleteProviderId = providerId;
    this.deleteProviderName = providerName;
    this.deleteModelId = model.id;
    this.deleteModelName = model.name;
    this.deleteOpen = true;
  }

  private closeDelete(): void {
    this.deleteOpen = false;
  }

  private deleteTitle(): string {
    return this.deleteKind === 'provider' ? '删除模型提供商？' : '删除模型？';
  }

  private deleteMessage(): string {
    if (this.deleteKind === 'provider') {
      return '将删除「' + this.deleteProviderName + '」及其全部模型配置，DSH 端会同步移除。';
    }
    return '将从「' + this.deleteProviderName + '」移除模型「' + this.deleteModelName + '」，DSH 端会同步移除。';
  }

  private confirmDelete(): void {
    this.deleteOpen = false;
    if (this.deleteKind === 'provider') {
      this.deleteProvider(this.deleteProviderId);
    } else {
      this.deleteModel(this.deleteProviderId, this.deleteModelId);
    }
  }

  /** 打开添加模型表单 */
  private openAddModel(providerId: string, providerName: string): void {
    this.addProviderId = providerId;
    this.addProviderName = providerName;
    this.sheetKind = 'add';
    this.sheetOpen = true;
    this.formId = '';
    this.formName = '';
    this.formContext = '';
    this.formMaxTokens = '';
    this.formText = true;
    this.formImage = false;
    this.formError = '';
    this.addOpen = true;
  }

  /** 提交添加模型（对齐 validateNewModel + appendModelsMutation） */
  private submitAddModel(): void {
    const id: string = this.formId.trim();
    if (id.length === 0) {
      this.formError = '请输入模型 ID';
      return;
    }
    if (!this.formText && !this.formImage) {
      this.formError = '至少选择一种输入类型';
      return;
    }
    const providerId: string = this.addProviderId;
    const contextText: string = this.formContext.trim();
    const maxText: string = this.formMaxTokens.trim();
    this.formError = '';

    this.mutate((freshProviders: Record<string, Object>, revision: number) => {
      const provider: Object | undefined = freshProviders[providerId];
      if (provider === undefined) {
        return null;
      }
      const rawModels: Object | undefined = (provider as Record<string, Object>)['models'];
      const models: Object[] = rawModels !== undefined && Array.isArray(rawModels) ? rawModels as Object[] : [];
      for (const one of models) {
        if (String((one as Record<string, Object>)['id']) === id) {
          return null;
        }
      }
      // 构造模型对象
      const model: Record<string, Object> = { 'id': id };
      const name: string = this.formName.trim();
      if (name.length > 0) {
        model['name'] = name;
      }
      if (contextText.length > 0) {
        const parsed: number = Number(contextText);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          return null;
        }
        model['contextWindow'] = parsed;
      }
      if (maxText.length > 0) {
        const parsed2: number = Number(maxText);
        if (!Number.isSafeInteger(parsed2) || parsed2 <= 0) {
          return null;
        }
        model['maxTokens'] = parsed2;
      }
      const inputs: string[] = [];
      if (this.formText) {
        inputs.push('text');
      }
      if (this.formImage) {
        inputs.push('image');
      }
      model['input'] = inputs;
      if (this.formReasoning) {
        const parts: string[] = ['\"off\":null'];
        const seen: string[] = [];
        let declared: number = 0;
        for (const row of this.formReasoningRows) {
          if (row.level === 'off' || seen.indexOf(row.level) >= 0) {
            continue;
          }
          seen.push(row.level);
          const wire: string = row.value.trim().length > 0 ? row.value.trim() : row.level;
          parts.push('\"' + row.level + '\":\"' + wire + '\"');
          declared += 1;
        }
        if (declared === 0) {
          return null;
        }
        model['reasoningEfforts'] = JSON.parse('{' + parts.join(',') + '}') as Object;
      } else {
        model['reasoningEfforts'] = false;
      }
      return appendModelsMutation(providerId, models.length, [model], revision);
    }, '模型已添加', () => {
      this.closeSheets();
    });
  }

  /** 打开「获取模型」并调用网关发现接口（llm-discover-models）。 */
  private openDiscovery(provider: ProviderRow): void {
    this.discoverProviderId = provider.id;
    this.discoverProviderName = provider.name;
    this.discoverRows = [];
    this.discoverSelected = [];
    this.discoverError = '';
    this.discoverNeedsManual = false;
    this.discoverLoading = true;
    this.discoverOpen = true;
    this.sheetKind = 'discover';
    this.sheetOpen = true;
    const existing: string[] = [];
    for (const row of provider.models) {
      existing.push(row.id);
    }
    // 与小程序一致：只要提供商配置里有 baseURL 就带上；没有内置目录的提供商
    // （如 step）必须靠 baseURL 才能列出模型。
    const discoverBase: string = provider.baseURL;
    GatewayClient.get().discoverModels(PI_NS, provider.id, discoverBase, '', '').then((frame: GatewayFrame) => {
      this.discoverLoading = false;
      this.discoverRows = parseDiscoveredModels(frame, existing, this.levelLabels());
      if (this.discoverRows.length === 0) {
        this.discoverError = '没有获取到可用模型';
      }
    }).catch((err: Error) => {
      this.discoverLoading = false;
      const raw: string = err.message;
      const lower: string = raw.toLowerCase();
      // 宿主原始报错（pi-ai ships no catalog … set a baseURL … by hand）翻译成可操作提示
      if (lower.indexOf('no catalog') >= 0 || lower.indexOf('baseurl') >= 0 || lower.indexOf('by hand') >= 0) {
        this.discoverNeedsManual = true;
        this.discoverError = '该提供商没有内置模型目录：需要先在提供商配置里填写接口地址（baseURL），或直接手动添加模型。';
      } else {
        this.discoverError = raw.length > 0 ? raw : '获取模型失败，请重试';
      }
      Logger.warn('discover failed provider=' + provider.id + ' baseURL=' + discoverBase + ' err=' + raw);
    });
  }

  /** 默认档位行：关闭 + 低/中/高（对齐小程序 defaultReasoningRows） */
  private defaultReasoningRows(): ReasoningRowDraft[] {
    return [
      { level: 'off', value: '' },
      { level: 'low', value: 'low' },
      { level: 'medium', value: 'medium' },
      { level: 'high', value: 'high' }
    ];
  }

  private reasoningLevelLabel(level: string): string {
    if (level === 'off') return '关闭';
    return level;
  }

  private toggleFormReasoning(on: boolean): void {
    this.formReasoning = on;
    if (on && this.formReasoningRows.length === 0) {
      this.formReasoningRows = this.defaultReasoningRows();
    }
  }

  private addReasoningRow(): void {
    const used: string[] = [];
    for (const row of this.formReasoningRows) {
      used.push(row.level);
    }
    for (const level of REASONING_LEVELS) {
      if (used.indexOf(level) < 0) {
        const rows: ReasoningRowDraft[] = this.formReasoningRows.slice();
        rows.push({ level: level, value: level });
        this.formReasoningRows = rows;
        return;
      }
    }
  }

  private removeReasoningRow(index: number): void {
    if (index < 0 || index >= this.formReasoningRows.length) {
      return;
    }
    const rows: ReasoningRowDraft[] = [];
    for (let i = 0; i < this.formReasoningRows.length; i++) {
      if (i !== index) {
        rows.push(this.formReasoningRows[i]);
      }
    }
    this.formReasoningRows = rows;
  }

  private setReasoningLevel(index: number, level: string): void {
    if (index < 0 || index >= this.formReasoningRows.length) {
      return;
    }
    const rows: ReasoningRowDraft[] = this.formReasoningRows.slice();
    for (const row of rows) {
      if (row !== rows[index] && row.level === level) {
        return;
      }
    }
    const row: ReasoningRowDraft = rows[index];
    const oldLevel: string = row.level;
    rows[index] = { level: level, value: level === 'off' ? '' : (row.value.length === 0 || row.value === oldLevel ? level : row.value) };
    this.formReasoningRows = rows;
  }

  private setReasoningValue(index: number, value: string): void {
    if (index < 0 || index >= this.formReasoningRows.length) {
      return;
    }
    const rows: ReasoningRowDraft[] = this.formReasoningRows.slice();
    rows[index] = { level: rows[index].level, value: value };
    this.formReasoningRows = rows;
  }

  private reasoningMenu(index: number): MenuElement[] {
    const items: MenuElement[] = [];
    items.push({ value: '关闭（off）', action: () => { this.setReasoningLevel(index, 'off'); } });
    for (const level of REASONING_LEVELS) {
      items.push({ value: level, action: () => { this.setReasoningLevel(index, level); } });
    }
    return items;
  }

  private toggleDiscoverRow(id: string): void {
    const next: string[] = [];
    let found: boolean = false;
    for (const one of this.discoverSelected) {
      if (one === id) {
        found = true;
      } else {
        next.push(one);
      }
    }
    if (!found) {
      next.push(id);
    }
    this.discoverSelected = next;
  }

  private selectAllDiscover(): void {
    if (this.discoverSelected.length === this.discoverRows.length) {
      this.discoverSelected = [];
      return;
    }
    const all: string[] = [];
    for (const row of this.discoverRows) {
      all.push(row.id);
    }
    this.discoverSelected = all;
  }

  /** 批量添加勾选的模型。 */
  private submitDiscovery(): void {
    const picked: string[] = this.discoverSelected.slice();
    if (picked.length === 0) {
      return;
    }
    const providerId: string = this.discoverProviderId;
    const names: Record<string, string> = {};
    for (const row of this.discoverRows) {
      names[row.id] = row.name;
    }
    this.mutate((freshProviders: Record<string, Object>, revision: number): Object[] | null => {
      const models: Object[] = [];
      for (const id of picked) {
        models.push(discoveredModelPayload(id, names[id] !== undefined ? names[id] : ''));
      }
      let count: number = 0;
      const provider: Object | undefined = freshProviders[providerId];
      if (provider !== undefined) {
        const list: Object | undefined = (provider as Record<string, Object>)['models'];
        if (list !== undefined && Array.isArray(list)) {
          count = (list as Object[]).length;
        }
      }
      return appendModelsMutation(providerId, count, models, revision);
    }, '已添加 ' + picked.length + ' 个模型', () => {
      this.closeSheets();
      this.discoverSelected = [];
    });
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.BottomStart }) {

        Column()
          .width('100%')
          .height(44 + (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9))
          .backdropBlur(12)
          .backgroundColor(Color.Transparent)
          .hitTestBehavior(HitTestMode.None)
        Column() {
          // 导航
          Row() {
            NavBackButton({ isDark: this.isDark })
              .onClick(() => {
                this.pageStack.pop();
              })
            Text('模型')
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.textColor())
              .layoutWeight(1)
              .textAlign(TextAlign.Center)
            Row().width(40)
          }
          .width('100%')
          .height(44)
          .padding({ left: 8, right: 8 })
          .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })
        .zIndex(10)

          Scroll() {
            Column({ space: 0 }) {
              if (this.hint.length > 0) {
                Text(this.hint)
                  .fontSize(12.5)
                  .fontColor('#FF9500')
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 8, bottom: 8 })
              }

              if (this.loading) {
                Text('正在读取模型…')
                  .fontSize(13)
                  .fontColor(this.subColor())
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding({ top: 40, bottom: 40 })
              } else if (this.error.length > 0) {
                Text(this.error)
                  .fontSize(13)
                  .fontColor('#FF3B30')
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding({ top: 40, bottom: 12 })
                Text('重试')
                  .fontSize(14)
                  .fontColor('#2E6BE6')
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding({ bottom: 40 })
                  .onClick(() => {
                    this.refresh();
                  })
              } else if (this.providers.length === 0) {
                Text('还没有可配置的模型提供商')
                  .fontSize(14)
                  .fontColor(this.textColor())
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding({ top: 40, bottom: 8 })
                Text('请先在 DSH 客户端 → 设置 → 模型中添加模型提供商，保存后会自动同步到这里。')
                  .fontSize(12.5)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding({ left: 24, right: 24, bottom: 40 })
              } else {
                Row() {
                  Text('模型提供商')
                    .fontSize(12.5)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.subColor())
                    .letterSpacing(0.5)
                  Blank()
                  Text(this.providers.length.toString() + ' 个')
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .margin({ right: 10 })
                  Row() {
                    Text('↻')
                      .fontSize(15)
                      .fontColor(this.subColor())
                  }
                  .width(30)
                  .height(30)
                  .justifyContent(FlexAlign.Center)
                  .border({ width: 1, color: this.dividerColor() })
                  .borderRadius(15)
                  .onClick(() => {
                    this.refresh();
                  })
                }
                .width('100%')
                .padding({ left: 18, right: 18, top: 6, bottom: 8 })

                Column({ space: 0 }) {
                ForEach(this.providers, (provider: ProviderRow) => {
                  Column({ space: 0 }) {
                    Row() {
                      Text(provider.name)
                        .fontSize(18.5)
                        .fontWeight(FontWeight.Bold)
                        .fontColor(this.textColor())
                        .constraintSize({ maxWidth: '44%' })
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      if (provider.custom) {
                        Text('自定义')
                          .fontSize(11)
                          .fontColor(this.subColor())
                          .border({ width: 1, color: this.dividerColor() })
                          .borderRadius(999)
                          .padding({ left: 7, right: 7, top: 1.5, bottom: 1.5 })
                          .margin({ left: 6 })
                      }
                      Circle({ width: 8, height: 8 })
                        .fill(this.providerStatusColor(provider.status))
                        .margin({ left: 8 })
                      Blank()
                      // 展开/收起只靠箭头提示，整行可点（去掉「编辑/完成」按钮）
                      Text('›')
                        .fontSize(16)
                        .fontColor(this.subColor())
                        .rotate({ angle: this.expandedId === provider.id ? 90 : 0 })
                      Row() {
                        Image($r('app.media.trash_red'))
                          .width(15)
                          .height(15)
                          .objectFit(ImageFit.Contain)
                      }
                      .width(34)
                      .height(34)
                      .justifyContent(FlexAlign.Center)
                      .borderRadius(17)
                      .margin({ left: 6 })
                      .hitTestBehavior(HitTestMode.Block)
                      .onClick(() => {
                        this.openDeleteProvider(provider);
                      })
                    }
                    .width('100%')
                    .constraintSize({ minHeight: 56 })
                    .padding({ left: 16, right: 16, top: 13, bottom: 13 })
                    .onClick(() => {
                      this.toggleProvider(provider.id);
                    })

                    if (this.expandedId === provider.id) {
                      Column({ space: 0 }) {
                        // 元信息：标签左 / 值右，行间分隔线（小程序 provider-meta-row 最终样式）
                        Row() {
                          Text('API 协议')
                            .fontSize(13.5)
                            .fontColor(this.subColor())
                          Blank()
                          Text(provider.apiLabel.length > 0 ? provider.apiLabel : '—')
                            .fontSize(13.5)
                            .fontColor(this.subColor())
                        }
                        .width('100%')
                        .padding({ top: 6, bottom: 6 })

                        Row() {
                          Text('接口地址')
                            .fontSize(13.5)
                            .fontColor(this.subColor())
                          Blank()
                          Text(provider.baseURL.length > 0 ? provider.baseURL : '默认端点')
                            .fontSize(13.5)
                            .fontColor(this.subColor())
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .constraintSize({ maxWidth: 210 })
                        }
                        .width('100%')
                        .padding({ top: 6, bottom: 6 })
                        .border({ width: { top: 1 }, color: this.dividerColor() })

                        // 模型区标题：模型 + 计数胶囊 + 获取模型
                        Row() {
                          Text('模型')
                            .fontSize(16)
                            .fontWeight(FontWeight.Bold)
                            .fontColor(this.textColor())
                          Text(provider.count + ' 个模型')
                            .fontSize(12.5)
                            .fontColor(this.subColor())
                            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.07)')
                            .borderRadius(999)
                            .padding({ left: 7, right: 7, top: 2, bottom: 2 })
                            .margin({ left: 6 })
                          Blank()
                          Text('获取模型')
                            .fontSize(14)
                            .fontColor(this.textColor())
                            .height(34)
                            .padding({ left: 13, right: 13 })
                            .textAlign(TextAlign.Center)
                            .border({ width: 1, color: this.dashEdge() })
                            .borderRadius(999)
                            .onClick(() => {
                              this.openDiscovery(provider);
                            })
                        }
                        .width('100%')
                        .padding({ top: 10, bottom: 6 })

                        if (provider.models.length === 0) {
                          Text('这个提供商还没有模型')
                            .fontSize(13.5)
                            .fontColor(this.subColor())
                            .width('100%')
                            .padding({ top: 10, bottom: 10 })
                        }

                        ForEach(provider.models, (model: ModelRow) => {
                          Row() {
                            Column({ space: 0 }) {
                              Row({ space: 6 }) {
                                Text(model.name)
                                  .fontSize(17)
                                  .fontWeight(FontWeight.Bold)
                                  .fontColor(this.textColor())
                                  .maxLines(1)
                                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                                if (model.isDefault) {
                                  Text('默认')
                                    .fontSize(11)
                                    .fontColor('#2E6BE6')
                                    .backgroundColor(this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
                                    .borderRadius(999)
                                    .padding({ left: 7, right: 7, top: 2, bottom: 2 })
                                }
                              }
                              .width('100%')

                              Text(model.id)
                                .fontSize(12.5)
                                .fontColor(this.subColor())
                                .maxLines(1)
                                .textOverflow({ overflow: TextOverflow.Ellipsis })
                                .width('100%')
                                .margin({ top: 3 })

                              if (model.meta.length > 0) {
                                Text(model.meta)
                                  .fontSize(12.5)
                                  .fontColor(this.subColor())
                                  .maxLines(1)
                                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                                  .width('100%')
                                  .margin({ top: 4 })
                              }
                            }
                            .alignItems(HorizontalAlign.Start)
                            .layoutWeight(1)

                            Row() {
                              Image($r('app.media.trash_red'))
                                .width(15)
                                .height(15)
                                .objectFit(ImageFit.Contain)
                            }
                            .width(34)
                            .height(34)
                            .justifyContent(FlexAlign.Center)
                            .borderRadius(17)
                            .margin({ left: 6 })
                            .hitTestBehavior(HitTestMode.Block)
                            .onClick(() => {
                              this.openDeleteModel(provider.id, provider.name, model);
                            })
                          }
                          .width('100%')
                          .alignItems(VerticalAlign.Center)
                          .padding({ top: 12, bottom: 12 })
                          .border({ width: { bottom: 1 }, color: this.dividerColor() })
                        }, (model: ModelRow) => model.id)

                        Row() {
                          Text('＋')
                            .fontSize(17.5)
                            .fontColor(this.textColor())
                          Text('添加模型')
                            .fontSize(15)
                            .fontColor(this.textColor())
                            .margin({ left: 5 })
                        }
                        .width('100%')
                        .height(49)
                        .justifyContent(FlexAlign.Center)
                        .backgroundColor(this.dashBg())
                        .border({ width: 1, color: this.dashEdge(), style: BorderStyle.Dashed })
                        .borderRadius(12)
                        .margin({ top: 10 })
                        .onClick(() => {
                          this.openAddModel(provider.id, provider.name);
                        })
                      }
                      .width('100%')
                      .padding({ left: 18, right: 18, top: 2, bottom: 16 })
                      .border({ width: { top: 1 }, color: this.dividerColor() })
                    }
                  }
                  .width('100%')
                  .backgroundColor(this.glassCardBg())
                  .border({ width: 1, color: this.glassEdge() })
                  .borderRadius(16)
                  .margin({ bottom: 10 })
                  .clip(true)
                }, (provider: ProviderRow) => provider.id)
                }
                .width('100%')
                .padding({ left: 16, right: 16 })

                Row() {
                  Row() {
                    Text('＋')
                      .fontSize(18)
                      .fontWeight(FontWeight.Medium)
                      .fontColor('#2E6BE6')
                    Text('添加模型提供商')
                      .fontSize(15.5)
                      .fontWeight(FontWeight.Medium)
                      .fontColor('#2E6BE6')
                      .margin({ left: 6 })
                  }
                  .width('100%')
                  .height(50)
                  .justifyContent(FlexAlign.Center)
                  .backgroundColor(Color.Transparent)
                  .border({ width: 1, color: this.dashEdge(), style: BorderStyle.Dashed })
                  .borderRadius(14)
                  .onClick(() => {
                    this.pageStack.pushPathByName('add-provider', null);
                  })
                }
                .width('100%')
                .padding({ left: 16, right: 16, top: 4 })

                Text('提供商配置与 API Key 会写入 DSH，数据和 DSH 客户端双向同步。')
                  .fontSize(11.5)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 20, right: 20, top: 6 })
                Text('管理已配置提供商的模型；修改会同步到 DSH 客户端。')
                  .fontSize(11.5)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 20, right: 20, top: 4, bottom: 30 })
              }
            }
            .width('100%')
            .padding({ top: 4 })
          }
          .layoutWeight(1)
          .align(Alignment.Top)
          .scrollBar(BarState.Off)
              .padding({ top: 44 + (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) })
              .margin({ top: -(44 + (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9)) })
        }
        .width('100%')
        .height('100%')
        .backgroundColor(this.pageBg())


        if (this.discoverOpen) {
          Column()
            .width('100%')
            .height('100%')
            .backgroundColor('rgba(0,0,0,0.42)')
            .onClick(() => {
              if (!this.saving) {
                this.closeSheets();
              }
            })

          Column({ space: 0 }) {
            Column() {
              Column()
                .width(36)
                .height(4)
                .borderRadius(2)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
            }
            .width('100%')
            .height(14)
            .justifyContent(FlexAlign.Center)

            Stack({ alignContent: Alignment.Center }) {
              Column({ space: 2 }) {
                Text('获取模型')
                  .fontSize(17)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                Text(this.discoverProviderName)
                  .fontSize(11.5)
                  .fontColor(this.subColor())
              }
              .alignItems(HorizontalAlign.Center)
              Row() {
                Text('取消')
                  .fontSize(16)
                  .fontColor(this.textColor())
                  .height(44)
                  .onClick(() => {
                    if (!this.saving) {
                      this.closeSheets();
                    }
                  })
                Blank()
                Text(this.saving ? '正在添加…' : '添加 ' + this.discoverSelected.length + ' 个')
                  .fontSize(16)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.saving ? this.subColor() : '#2E6BE6')
                  .height(44)
                  .onClick(() => {
                    if (!this.saving) {
                      this.submitDiscovery();
                    }
                  })
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
            }
            .width('100%')
            .height(52)

            if (this.discoverLoading) {
              Text('正在获取模型…')
                .fontSize(14)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ top: 34, bottom: 44 })
                .textAlign(TextAlign.Center)
            } else if (this.discoverError.length > 0) {
              Column({ space: 12 }) {
                Text(this.discoverError)
                  .fontSize(13)
                  .lineHeight(19)
                  .fontColor('#FF5A5F')
                  .width('100%')
                if (this.discoverNeedsManual) {
                  Text('手动添加模型')
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor('#FFFFFF')
                    .width('100%')
                    .height(42)
                    .textAlign(TextAlign.Center)
                    .borderRadius(11)
                    .backgroundColor('#2E6BE6')
                    .onClick(() => {
                      const providerId: string = this.discoverProviderId;
                      const providerName: string = this.discoverProviderName;
                      this.closeSheets();
                      this.openAddModel(providerId, providerName);
                    })
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ left: 18, right: 18, top: 8, bottom: 24 })
            } else {
              Row() {
                Text('已选择 ' + this.discoverSelected.length + ' 个')
                  .fontSize(12.5)
                  .fontColor(this.subColor())
                Blank()
                Text(this.discoverSelected.length === this.discoverRows.length ? '取消全选' : '全选')
                  .fontSize(13.5)
                  .fontColor('#2E6BE6')
                  .onClick(() => {
                    this.selectAllDiscover();
                  })
              }
              .width('100%')
              .padding({ left: 18, right: 18, bottom: 6 })

              Scroll() {
                Column({ space: 0 }) {
                  ForEach(this.discoverRows, (row: DiscoveredModel) => {
                    Row() {
                      Text(this.discoverSelected.indexOf(row.id) >= 0 ? '✓' : '')
                        .fontSize(11)
                        .fontColor('#FFFFFF')
                        .width(19)
                        .height(19)
                        .textAlign(TextAlign.Center)
                        .backgroundColor(this.discoverSelected.indexOf(row.id) >= 0 ? '#2E6BE6' : 'rgba(16,19,24,0.05)')
                        .border({ width: 1, color: this.discoverSelected.indexOf(row.id) >= 0 ? '#2E6BE6' : this.dividerColor() })
                        .borderRadius(5)
                      Column({ space: 2 }) {
                        Row({ space: 6 }) {
                          Text(row.name)
                            .fontSize(15)
                            .fontWeight(FontWeight.Medium)
                            .fontColor(this.textColor())
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                          if (row.existing) {
                            Text('已添加')
                              .fontSize(10.5)
                              .fontColor(this.subColor())
                              .border({ width: 1, color: this.dividerColor() })
                              .borderRadius(999)
                              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                          }
                        }
                        .width('100%')
                        Text(row.id)
                          .fontSize(11)
                          .fontColor(this.subColor())
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                          .width('100%')
                        if (row.meta.length > 0) {
                          Text(row.meta)
                            .fontSize(11)
                            .fontColor(this.subColor())
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%')
                        }
                      }
                      .alignItems(HorizontalAlign.Start)
                      .layoutWeight(1)
                      .margin({ left: 9 })
                    }
                    .width('100%')
                    .alignItems(VerticalAlign.Center)
                    .padding({ top: 9, bottom: 9 })
                    .onClick(() => {
                      this.toggleDiscoverRow(row.id);
                    })
                  }, (row: DiscoveredModel) => row.id)
                }
                .width('100%')
              }
              .constraintSize({ maxHeight: 380 })
              .scrollBar(BarState.Off)
              .align(Alignment.Top)
              .width('100%')
              .padding({ left: 18, right: 18 })
            }

            Row({ space: 10 }) {
              Text('取消')
                .fontSize(17)
                .fontColor(this.textColor())
                .textAlign(TextAlign.Center)
                .layoutWeight(1)
                .height(50)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
                .border({ width: 1, color: this.dividerColor() })
                .borderRadius(11)
                .onClick(() => {
                  if (!this.saving) {
                    this.closeSheets();
                  }
                })
              Text(this.saving ? '正在添加…' : '添加 ' + this.discoverSelected.length + ' 个')
                .fontSize(17)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.discoverSelected.length > 0 ? this.textColor() : this.subColor())
                .textAlign(TextAlign.Center)
                .layoutWeight(1)
                .height(50)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
                .border({ width: 1, color: this.dividerColor() })
                .borderRadius(11)
                .opacity(this.saving ? 0.55 : 1)
                .onClick(() => {
                  if (!this.saving) {
                    this.submitDiscovery();
                  }
                })
            }
            .width('100%')
            .padding({ left: 18, right: 18, top: 12, bottom: 14 })
          }
          .width('100%')
          .constraintSize({ maxHeight: '86%' })
          .borderRadius({ topLeft: 20, topRight: 20 })
          .backgroundColor(appGlassFill(this.isDark))
          .backdropBlur(appGlassBlur(this.isDark))
          .border({ width: 1, color: appGlassBorderColor(this.isDark) })
          .shadow(appGlassShadow(this.isDark))
          .padding({ bottom: this.safeBottomStorage > 0 ? this.safeBottomStorage : 20 })
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ y: 420 })).animation({ duration: 320, curve: Curve.Friction }))
        }

        if (this.addOpen) {
          Column()
            .width('100%')
            .height('100%')
            .backgroundColor('rgba(0,0,0,0.42)')
            .onClick(() => {
              if (!this.saving) {
                this.closeSheets();
              }
            })

          Column({ space: 0 }) {
            Column() {
              Column()
                .width(36)
                .height(4)
                .borderRadius(2)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
            }
            .width('100%')
            .height(14)
            .justifyContent(FlexAlign.Center)

            Stack({ alignContent: Alignment.Center }) {
              Column({ space: 2 }) {
                Text('添加模型')
                  .fontSize(17)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                Text(this.addProviderName)
                  .fontSize(11.5)
                  .fontColor(this.subColor())
              }
              .alignItems(HorizontalAlign.Center)
              Row() {
                Text('取消')
                  .fontSize(16)
                  .fontColor(this.textColor())
                  .height(44)
                  .onClick(() => {
                    if (!this.saving) {
                      this.closeSheets();
                    }
                  })
                Blank()
                Text(this.saving ? '正在保存…' : '添加')
                  .fontSize(16)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.saving ? this.subColor() : '#2E6BE6')
                  .height(44)
                  .onClick(() => {
                    if (!this.saving) {
                      this.submitAddModel();
                    }
                  })
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
            }
            .width('100%')
            .height(52)

            Scroll() {
              Column({ space: 0 }) {
                Text('手动填写模型 ID 与参数；也可在提供商卡片里点「获取模型」批量导入。')
                  .fontSize(12)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ bottom: 12 })

                Text('模型 ID')
                  .fontSize(13)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ bottom: 6 })
                TextInput({ text: this.formId, placeholder: '上游接口使用的模型 ID' })
                  .height(46)
                  .fontSize(15)
                  .padding({ left: 12, right: 12 })
                  .fontColor(this.textColor())
                  .placeholderColor(this.subColor())
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
                  .border({ width: 1, color: this.dividerColor() })
                  .borderRadius(9)
                  .margin({ bottom: 14 })
                  .onChange((v: string) => {
                    this.formId = v;
                  })

                Text('显示名称')
                  .fontSize(13)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ bottom: 6 })
                TextInput({ text: this.formName, placeholder: '可选' })
                  .height(46)
                  .fontSize(15)
                  .padding({ left: 12, right: 12 })
                  .fontColor(this.textColor())
                  .placeholderColor(this.subColor())
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
                  .border({ width: 1, color: this.dividerColor() })
                  .borderRadius(9)
                  .margin({ bottom: 14 })
                  .onChange((v: string) => {
                    this.formName = v;
                  })

                Row({ space: 10 }) {
                  Column({ space: 0 }) {
                Text('上下文窗口')
                  .fontSize(13)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ bottom: 6 })
                TextInput({ text: this.formContext, placeholder: '1000000' })
                  .height(46)
                  .fontSize(15)
                  .padding({ left: 12, right: 12 })
                  .type(InputType.Number)
                  .fontColor(this.textColor())
                  .placeholderColor(this.subColor())
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
                  .border({ width: 1, color: this.dividerColor() })
                  .borderRadius(9)
                  .margin({ bottom: 14 })
                  .onChange((v: string) => {
                    this.formContext = v;
                  })
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                  Column({ space: 0 }) {
                Text('最大输出 Token')
                  .fontSize(13)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ bottom: 6 })
                TextInput({ text: this.formMaxTokens, placeholder: '8192' })
                  .height(46)
                  .fontSize(15)
                  .padding({ left: 12, right: 12 })
                  .type(InputType.Number)
                  .fontColor(this.textColor())
                  .placeholderColor(this.subColor())
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
                  .border({ width: 1, color: this.dividerColor() })
                  .borderRadius(9)
                  .margin({ bottom: 14 })
                  .onChange((v: string) => {
                    this.formMaxTokens = v;
                  })
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                }
                .width('100%')

                Text('输入类型')
                  .fontSize(13)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ bottom: 8 })
                Row({ space: 22 }) {
                  Row({ space: 6 }) {
                    Text(this.formText ? '✓' : '')
                      .fontSize(11)
                      .fontColor('#FFFFFF')
                      .width(19)
                      .height(19)
                      .textAlign(TextAlign.Center)
                      .backgroundColor(this.formText ? '#2E6BE6' : 'rgba(16,19,24,0.05)')
                      .border({ width: 1, color: this.formText ? '#2E6BE6' : this.dividerColor() })
                      .borderRadius(5)
                    Text('文本').fontSize(15).fontColor(this.textColor())
                  }
                  .onClick(() => {
                    this.formText = !this.formText;
                  })
                  Row({ space: 6 }) {
                    Text(this.formImage ? '✓' : '')
                      .fontSize(11)
                      .fontColor('#FFFFFF')
                      .width(19)
                      .height(19)
                      .textAlign(TextAlign.Center)
                      .backgroundColor(this.formImage ? '#2E6BE6' : 'rgba(16,19,24,0.05)')
                      .border({ width: 1, color: this.formImage ? '#2E6BE6' : this.dividerColor() })
                      .borderRadius(5)
                    Text('图片').fontSize(15).fontColor(this.textColor())
                  }
                  .onClick(() => {
                    this.formImage = !this.formImage;
                  })
                }
                .width('100%')
                .margin({ bottom: 14 })

                Row() {
                  Text('支持推理')
                    .fontSize(15)
                    .fontColor(this.textColor())
                  Blank()
                  Toggle({ type: ToggleType.Switch, isOn: this.formReasoning })
                    .selectedColor('#2E6BE6')
                    .onChange((on: boolean) => {
                      this.toggleFormReasoning(on);
                    })
                }
                .width('100%')
                .height(38)

                if (this.formReasoning) {
                  Row() {
                    Text('档位')
                      .fontSize(12)
                      .fontColor(this.subColor())
                      .layoutWeight(1)
                    Text('API 参数值')
                      .fontSize(12)
                      .fontColor(this.subColor())
                      .layoutWeight(1)
                      .textAlign(TextAlign.Center)
                    Row().width(28)
                  }
                  .width('100%')
                  .padding({ top: 10, bottom: 4 })

                  ForEach(this.formReasoningRows, (row: ReasoningRowDraft, index: number) => {
                    Row({ space: 8 }) {
                      Row({ space: 4 }) {
                        Text(this.reasoningLevelLabel(row.level))
                          .fontSize(14)
                          .fontColor(this.textColor())
                        Text('⌄')
                          .fontSize(11)
                          .fontColor(this.subColor())
                      }
                      .layoutWeight(1)
                      .height(40)
                      .justifyContent(FlexAlign.Center)
                      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
                      .border({ width: 1, color: this.dividerColor() })
                      .borderRadius(9)
                      .bindMenu(this.reasoningMenu(index))

                      TextInput({ text: row.value, placeholder: row.level === 'off' ? '关闭思考' : row.level })
                        .layoutWeight(1)
                        .height(40)
                        .fontSize(14)
                        .enabled(row.level !== 'off')
                        .textAlign(TextAlign.Center)
                        .padding({ left: 8, right: 8 })
                        .fontColor(this.textColor())
                        .placeholderColor(this.subColor())
                        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
                        .border({ width: 1, color: this.dividerColor() })
                        .borderRadius(9)
                        .onChange((v: string) => {
                          this.setReasoningValue(index, v);
                        })

                      Text('×')
                        .fontSize(16)
                        .fontColor(this.subColor())
                        .width(28)
                        .height(28)
                        .textAlign(TextAlign.Center)
                        .onClick(() => {
                          this.removeReasoningRow(index);
                        })
                    }
                    .width('100%')
                    .padding({ top: 5, bottom: 5 })
                  }, (row: ReasoningRowDraft, index: number) => row.level + '-' + index.toString())

                  Text('＋ 添加档位')
                    .fontSize(14)
                    .fontColor('#2E6BE6')
                    .width('100%')
                    .height(40)
                    .textAlign(TextAlign.Center)
                    .border({ width: 1, color: this.dashEdge(), style: BorderStyle.Dashed })
                    .borderRadius(9)
                    .margin({ top: 6 })
                    .onClick(() => {
                      this.addReasoningRow();
                    })

                  Text('关闭表示不支持推理；开启后可配置档位与 API 参数值。')
                    .fontSize(11.5)
                    .lineHeight(17)
                    .fontColor(this.subColor())
                    .width('100%')
                    .margin({ top: 8 })
                }

                Text('留空表示使用提供商默认值；模型 ID 必须与上游一致。')
                  .fontSize(12)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')

                if (this.formError.length > 0) {
                  Text(this.formError)
                    .fontSize(13)
                    .lineHeight(19)
                    .fontColor('#FF5A5F')
                    .width('100%')
                    .margin({ top: 8 })
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }
            .constraintSize({ maxHeight: 470 })
            .scrollBar(BarState.Off)
            .align(Alignment.Top)
            .width('100%')
            .padding({ left: 18, right: 18, top: 2 })

            Row({ space: 10 }) {
              Text('取消')
                .fontSize(17)
                .fontColor(this.textColor())
                .textAlign(TextAlign.Center)
                .layoutWeight(1)
                .height(50)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
                .border({ width: 1, color: this.dividerColor() })
                .borderRadius(11)
                .onClick(() => {
                  if (!this.saving) {
                    this.closeSheets();
                  }
                })
              Text(this.saving ? '正在保存…' : '添加')
                .fontSize(17)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.textColor())
                .textAlign(TextAlign.Center)
                .layoutWeight(1)
                .height(50)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
                .border({ width: 1, color: this.dividerColor() })
                .borderRadius(11)
                .opacity(this.saving ? 0.55 : 1)
                .onClick(() => {
                  if (!this.saving) {
                    this.submitAddModel();
                  }
                })
            }
            .width('100%')
            .padding({ left: 18, right: 18, top: 12, bottom: 14 })
          }
          .width('100%')
          .constraintSize({ maxHeight: '86%' })
          .borderRadius({ topLeft: 20, topRight: 20 })
          .backgroundColor(appGlassFill(this.isDark))
          .backdropBlur(appGlassBlur(this.isDark))
          .border({ width: 1, color: appGlassBorderColor(this.isDark) })
          .shadow(appGlassShadow(this.isDark))
          .padding({ bottom: this.safeBottomStorage > 0 ? this.safeBottomStorage : 20 })
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ y: 420 })).animation({ duration: 320, curve: Curve.Friction }))
        }

        // 删除确认（原生玻璃居中弹窗）
        if (this.deleteOpen) {
          Stack({ alignContent: Alignment.Center }) {
            Column()
              .width('100%')
              .height('100%')
              .backgroundColor('rgba(0,0,0,0.42)')
              .onClick(() => {
                if (!this.saving) {
                  this.closeDelete();
                }
              })
            Column({ space: 0 }) {
              Column({ space: 8 }) {
                Text(this.deleteTitle())
                  .fontSize(16.5)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                  .width('100%')
                Text(this.deleteMessage())
                  .fontSize(13)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ left: 18, right: 18, top: 18, bottom: 16 })

              Row() {
                Text('取消')
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.subColor())
                  .layoutWeight(1)
                  .height(42)
                  .textAlign(TextAlign.Center)
                  .borderRadius(10)
                  .border({ width: 1, color: this.dividerColor() })
                  .margin({ right: 8 })
                  .onClick(() => {
                    this.closeDelete();
                  })
                Text('删除')
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#FFFFFF')
                  .layoutWeight(1)
                  .height(42)
                  .textAlign(TextAlign.Center)
                  .borderRadius(10)
                  .backgroundColor('#FF3B30')
                  .onClick(() => {
                    this.confirmDelete();
                  })
              }
              .width('100%')
              .padding({ left: 18, right: 18, top: 4, bottom: 16 })
            }
            .width('86%')
            .borderRadius(16)
            .backgroundColor(appGlassFill(this.isDark))
            .backdropBlur(appGlassBlur(this.isDark))
            .border({ width: 1, color: appGlassBorderColor(this.isDark) })
            .shadow(appGlassShadow(this.isDark))
          }
          .width('100%')
          .height('100%')
        }

      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
