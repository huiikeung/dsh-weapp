import { asRec, GatewayClient, GatewayFrame, GatewayRequestFactory, Logger, PreferencesStore, SessionStore } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';

/** 模型行（网关 models 目录） */
class ModelRow {
  provider: string = '';
  model: string = '';
  label: string = '';
  defaultEffort: string = '';
  efforts: EffortOption[] = [];
}

/** 思考强度档位 */
class EffortOption {
  id: string = '';
  name: string = '';
}

/** 提供商分组（同一提供商一个标题行） */
class ModelGroupVm {
  title: string = '';
  items: ModelRow[] = [];
}

/** 思考强度文案（对齐小程序 effortDisplayName） */
function effortName(effort: string): string {
  const key: string = effort.toLowerCase();
  if (key === 'off' || key === 'none' || key === 'disabled') return 'Off';
  if (key === 'minimal') return 'Minimal';
  if (key === 'low') return 'Low';
  if (key === 'medium') return 'Medium';
  if (key === 'high') return 'High';
  if (key === 'xhigh') return 'XHigh';
  if (key === 'max') return 'Max';
  if (key === 'ultra') return 'Ultra';
  return effort;
}

/**
 * 默认模型二级页面（会话设置 → 默认模型）。
 *
 * 结构对齐小程序 pages/session-settings 的 model picker：
 *   提供商标题行 → 模型卡片（名称 + 当前使用徽标）→ 卡片内「思考等级」+ 档位 chip（常显）
 * 点模型名 = 只切模型；点档位 chip = 模型 + 思考等级一起保存（save-default-model）。
 */
@Component
export struct SessionDefaultModelPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('defaultModel') defaultModelValue: string = '';
  @StorageLink('defaultProvider') defaultProviderValue: string = '';
  @StorageLink('defaultEffort') defaultEffortValue: string = '';
  @StorageLink('connectionState') @Watch('onConnectionChanged') connection: string = 'disconnected';

  @State rows: ModelRow[] = [];
  @State loading: boolean = false;
  @State loaded: boolean = false;
  @State saving: boolean = false;
  /** 网关确认后的当前默认模型 / 思考等级 */
  @State savedModel: string = '';
  @State savedProvider: string = '';
  @State savedEffort: string = '';

  aboutToAppear(): void {
    this.reload();
  }

  onConnectionChanged(): void {
    if (this.connection === 'connected' && !this.loaded) {
      this.reload();
    }
  }

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  /** 卡片底 = 页面背景色（靠描边 + 投影分层） */
  private cardBg(): string {
    return this.pageBg();
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.52)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.08)' : 'rgba(16,19,24,0.06)';
  }

  /** 卡片边框 = 返回按钮同款 */
  private cardEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
    } catch (ignored) {
    }
  }

  /** 拉取模型目录：groups[]（提供商分组）+ current（权威当前模型与档位） */
  private reload(): void {
    if (this.loading) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.rows = [];
      this.loaded = false;
      return;
    }
    this.loading = true;
    // 模型目录帧一般带 default/current；旧网关可能没有，先单独拉一次部署级选择兜底
    client.requestDefaultModel();
    const sessionId: string = SessionStore.get().currentSessionId();
    const request = sessionId.length > 0
      ? GatewayRequestFactory.make('models', 'models', { 'sessionId': sessionId }, sessionId)
      : GatewayRequestFactory.simple('models');
    const applyFrame = (frame: GatewayFrame): boolean => {
      const rows: ModelRow[] = this.parseCatalog(frame);
      if (rows.length === 0) {
        return false;
      }
      this.loading = false;
      this.loaded = true;
      this.rows = rows;
      return true;
    };
    client.requestGateway(request, 15000).then((frame: GatewayFrame) => {
      if (applyFrame(frame)) {
        return;
      }
      // 会话级目录拿不到模型（会话已归档/切换到未知会话等）时，退回部署级目录：
      // 默认模型本来就是部署级设置，选择列表不应为空。
      client.requestGateway(GatewayRequestFactory.simple('models'), 15000).then((fallback: GatewayFrame) => {
        if (!applyFrame(fallback)) {
          this.loading = false;
          this.loaded = true;
          this.rows = [];
        }
      }).catch((error: Error) => {
        this.loading = false;
        this.loaded = true;
        this.loadCachedRows();
        this.toast('模型目录加载失败，已显示缓存');
      });
    }).catch((error: Error) => {
      client.requestGateway(GatewayRequestFactory.simple('models'), 15000).then((fallback: GatewayFrame) => {
        if (!applyFrame(fallback)) {
          this.loading = false;
          this.loaded = true;
          this.rows = [];
        }
      }).catch((fallbackError: Error) => {
        this.loading = false;
        this.loaded = true;
        this.loadCachedRows();
        this.toast('模型目录加载失败，已显示缓存');
      });
    });
  }

  /** 网关不可用时用本地缓存的模型目录兜底，保证选中态仍能显示 */
  private loadCachedRows(): void {
    const cached: Object[] = AppStorage.get<Object[]>('modelDetails') ?? [];
    if (cached.length === 0) {
      this.rows = [];
      return;
    }
    const rows: ModelRow[] = [];
    for (const one of cached) {
      const rec = one as Record<string, Object>;
      const model: string = String(rec['model'] ?? '');
      if (model.length === 0) {
        continue;
      }
      const row: ModelRow = new ModelRow();
      row.provider = String(rec['provider'] ?? '');
      row.model = model;
      const label: string = String(rec['label'] ?? '');
      row.label = label.length > 0 ? label : model;
      row.defaultEffort = String(rec['defaultEffort'] ?? '');
      rows.push(row);
    }
    this.rows = rows;
    this.savedModel = this.defaultModelValue.length > 0
      ? this.defaultModelValue : PreferencesStore.get().getString('defaultModel', '');
    this.savedProvider = this.defaultProviderValue.length > 0
      ? this.defaultProviderValue : PreferencesStore.get().getString('defaultProvider', '');
    Logger.info('MODELDBG cache rows=' + rows.length + ' saved=' + this.savedModel + ' provider=' + this.savedProvider);
  }

  private parseCatalog(frame: GatewayFrame): ModelRow[] {
    const rec = asRec(frame) ?? ({} as Record<string, Object>);
    const rawGroups = rec['groups'];
    const groups = rawGroups !== undefined && Array.isArray(rawGroups) ? rawGroups as Object[] : [];
    // 权威当前模型/档位：host 的模型目录帧用 `default` 字段（selection 结构），
    // 旧版本/其它命令可能用 `current`，两者都兼容；最后回退本地 AppStorage 默认值。
    // AppStorage 冷启动可能还没恢复：回落到本地偏好里保存的默认模型
    let currentModel: string = this.defaultModelValue;
    if (currentModel.length === 0) {
      currentModel = PreferencesStore.get().getString('defaultModel', '');
    }
    let currentProvider: string = this.savedProvider.length > 0
      ? this.savedProvider : PreferencesStore.get().getString('defaultProvider', '');
    let currentEffort: string = this.defaultEffortValue;
    if (currentEffort.length === 0) {
      currentEffort = PreferencesStore.get().getString('defaultEffort', '');
    }
    const applySelection = (value: Object | undefined): void => {
      if (value === undefined || Array.isArray(value)) {
        return;
      }
      const cur = value as Record<string, Object>;
      const cm: string = String(cur['model'] ?? '');
      if (cm.length > 0) {
        currentModel = cm;
      }
      const cp: string = String(cur['provider'] ?? '');
      if (cp.length > 0) {
        currentProvider = cp;
      }
      const ce: string = String(cur['reasoningEffort'] ?? '');
      if (ce.length > 0) {
        currentEffort = ce;
      }
    };
    applySelection(rec['default']);
    applySelection(rec['current']);
    // 冷启动时把网关下发的默认模型/档位写入全局，供会话设置页行副标题使用
    if (currentModel.length > 0) {
      AppStorage.setOrCreate<string>('defaultModel', currentModel);
      PreferencesStore.get().putString('defaultModel', currentModel);
    }
    if (currentProvider.length > 0) {
      AppStorage.setOrCreate<string>('defaultProvider', currentProvider);
      PreferencesStore.get().putString('defaultProvider', currentProvider);
    }
    if (currentEffort.length > 0) {
      AppStorage.setOrCreate<string>('defaultEffort', currentEffort);
      PreferencesStore.get().putString('defaultEffort', currentEffort);
    }
    const rows: ModelRow[] = [];
    for (const group of groups) {
      const g = group as Record<string, Object>;
      // host 目录帧的 provider 分组形状：{ id, name, models[] }（不是 provider/providerName）
      const provider: string = String(g['id'] ?? g['provider'] ?? '');
      const providerName: string = String(g['name'] ?? provider);
      const rawModels = g['models'];
      if (rawModels === undefined || !Array.isArray(rawModels)) {
        continue;
      }
      for (const one of rawModels as Object[]) {
        const m = one as Record<string, Object>;
        const row: ModelRow = new ModelRow();
        row.provider = provider;
        row.model = String(m['id'] ?? m['model'] ?? '');
        if (row.model.length === 0) {
          continue;
        }
        const name: string = String(m['name'] ?? '');
        row.label = name.length > 0 && name !== provider && name !== providerName ? name : row.model;
        const reasoning = m['reasoning'] as Record<string, Object> | undefined;
        // 默认档位在 reasoning.defaultEffort 上（host 目录帧结构），顶层字段仅作兼容
        const reasoningDefault: Object | undefined = reasoning === undefined ? undefined : reasoning['defaultEffort'];
        const topDefault: Object | undefined = m['defaultEffort'];
        row.defaultEffort = reasoningDefault !== undefined ? String(reasoningDefault)
          : (topDefault === undefined ? '' : String(topDefault));
        const efforts = reasoning === undefined ? undefined : reasoning['efforts'];
        if (efforts !== undefined && Array.isArray(efforts)) {
          for (const level of efforts as Object[]) {
            const er = level as Record<string, Object>;
            const id: string = String(er['id'] ?? '');
            if (id.length === 0) {
              continue;
            }
            const opt: EffortOption = new EffortOption();
            opt.id = id;
            const nm: string = String(er['name'] ?? '');
            opt.name = nm.length > 0 ? nm : effortName(id);
            row.efforts.push(opt);
          }
        }
        rows.push(row);
      }
    }
    // 提供商显示名：分组帧的 name 即显示名，缺失时回退 id
    this.providerTitles = new Map<string, string>();
    for (const group of groups) {
      const g = group as Record<string, Object>;
      const provider: string = String(g['id'] ?? g['provider'] ?? '');
      const pn: string = String(g['name'] ?? g['providerName'] ?? '');
      this.providerTitles.set(provider, pn.length > 0 ? pn : provider);
    }
    this.savedModel = currentModel;
    this.savedProvider = currentProvider;
    Logger.info('MODELDBG app=' + this.defaultModelValue + ' prefs=' + PreferencesStore.get().getString('defaultModel', '')
      + ' saved=' + this.savedModel + ' provider=' + this.savedProvider + ' rows=' + rows.length
      + (rows.length > 0 ? (' first=' + rows[0].provider + '/' + rows[0].model) : ''));
    this.savedEffort = currentEffort;
    // 同组模型显示名完全一致时（provider 名重复），回退到模型 id
    for (const one of rows) {
      let same: number = 0;
      let total: number = 0;
      for (const other of rows) {
        if (other.provider === one.provider) {
          total++;
          if (other.label === one.label) {
            same++;
          }
        }
      }
      if (total > 1 && same === total) {
        one.label = one.model;
      }
    }
    let dbgRows: string = '';
    for (const one of rows.slice(0, 5)) {
      dbgRows += one.provider + '/' + one.model + '=' + one.label + '; ';
    }
    Logger.info('modelRows: ' + dbgRows + ' total=' + rows.length);
    return rows;
  }

  /** provider id → 显示名（parseCatalog 里填充） */
  private providerTitles: Map<string, string> = new Map<string, string>();

  /** 按提供商分组（保持网关顺序） */
  private groupedRows(): ModelGroupVm[] {
    const groups: ModelGroupVm[] = [];
    for (const row of this.rows) {
      let group: ModelGroupVm | undefined = undefined;
      for (const one of groups) {
        if (one.title === this.providerTitle(row.provider)) {
          group = one;
          break;
        }
      }
      if (group === undefined) {
        group = new ModelGroupVm();
        group.title = this.providerTitle(row.provider);
        groups.push(group);
      }
      group.items.push(row);
    }
    return groups;
  }

  private providerTitle(provider: string): string {
    const name: string | undefined = this.providerTitles.get(provider);
    return name !== undefined && name.length > 0 ? name : provider;
  }

  /** 当前默认模型（只标记第一个匹配项，避免同名模型多个勾） */
  /** 解析当前默认模型所属 provider：优先已保存，其次部署默认，最后取第一个匹配行（避免同名模型在两个 provider 都打勾） */
  private currentModelKey(): string {
    if (this.savedModel.length > 0) {
      return this.savedModel;
    }
    if (this.defaultModelValue.length > 0) {
      return this.defaultModelValue;
    }
    return PreferencesStore.get().getString('defaultModel', '');
  }

  private providerHasModel(provider: string, model: string): boolean {
    if (provider.length === 0 || model.length === 0) {
      return false;
    }
    for (const one of this.rows) {
      if (one.provider === provider && one.model === model) {
        return true;
      }
    }
    return false;
  }

  private currentProvider(): string {
    const model: string = this.currentModelKey();
    // 已保存的 provider 必须能在目录里和该模型对上，否则视为失效（换过 provider 时会出现）
    if (this.providerHasModel(this.savedProvider, model)) {
      return this.savedProvider;
    }
    if (this.providerHasModel(this.defaultProviderValue, model)) {
      return this.defaultProviderValue;
    }
    for (const one of this.rows) {
      if (one.model === model) {
        return one.provider;
      }
    }
    return '';
  }

  private isCurrentModel(row: ModelRow): boolean {
    const model: string = this.currentModelKey();
    if (model.length === 0 || model !== row.model) {
      return false;
    }
    return this.currentProvider() === row.provider;
  }

  /** 页面顶部摘要：当前默认模型 + 档位 */
  private currentSummary(): string {
    for (const row of this.rows) {
      if (!this.isCurrentModel(row)) {
        continue;
      }
      const effort: string = this.currentEffortOf(row);
      return effort.length > 0 ? row.label + ' · ' + effortName(effort) : row.label;
    }
    return '未设置';
  }

  /** 顶部说明卡：当前默认摘要 + 说明 */
  @Builder
  introCard() {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Text('当前默认')
          .fontSize(12.4)
          .fontColor(this.subColor())
        Text(this.currentSummary())
          .fontSize(12.4)
          .fontWeight(FontWeight.Medium)
          .fontColor('#2E6BE6')
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      Text('为之后新建的会话设置默认模型与思考等级，运行中的会话保持启动时的配置；修改会同步 WebUI。')
        .fontSize(12.2)
        .lineHeight(18.4)
        .fontColor(this.subColor())
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .borderRadius(14)
    .backgroundColor(this.isDark ? 'rgba(46,107,230,0.15)' : 'rgba(46,107,230,0.07)')
    .margin({ bottom: 2 })
  }

  /** 当前模型的选中档位（只有当前模型才显示选中态，对齐小程序） */
  private currentEffortOf(row: ModelRow): string {
    if (this.isCurrentModel(row)) {
      const saved: string = this.savedEffort.length > 0 ? this.savedEffort : this.defaultEffortValue;
      if (saved.length > 0) {
        return saved;
      }
    }
    return '';
  }

  /** 保存部署级默认模型 + 思考等级（网关回执 save-default-model 刷新全局默认值） */
  private save(row: ModelRow, effort: string): void {
    if (this.saving) {
      return;
    }
    this.saving = true;
    // 先本地乐观更新，切换后立刻可见；网关回执失败再回滚
    const prevModel: string = this.savedModel;
    const prevProvider: string = this.savedProvider;
    const prevEffort: string = this.savedEffort;
    const prevDefaultModel: string = AppStorage.get<string>('defaultModel') ?? '';
    const prevDefaultEffort: string = AppStorage.get<string>('defaultEffort') ?? '';
    this.savedModel = row.model;
    this.savedProvider = row.provider;
    this.savedEffort = effort;
    AppStorage.setOrCreate<string>('defaultModel', row.model);
    AppStorage.setOrCreate<string>('defaultProvider', row.provider);
    AppStorage.setOrCreate<string>('defaultEffort', effort);
    // 同时落盘：重启 App 后模型页仍能标出已选模型
    PreferencesStore.get().putString('defaultModel', row.model);
    PreferencesStore.get().putString('defaultProvider', row.provider);
    PreferencesStore.get().putString('defaultEffort', effort);
    const request = GatewayRequestFactory.make('save-default-model', 'save-default-model',
      { 'provider': row.provider, 'model': row.model, 'reasoningEffort': effort });
    GatewayClient.get().requestGateway(request, 15000).then((frame: GatewayFrame) => {
      this.saving = false;
      this.savedModel = row.model;
      this.savedProvider = row.provider;
      this.savedEffort = effort;
      // 同步到全局：会话设置页「默认模型」行右侧要显示「模型 · 推理强度」
      AppStorage.setOrCreate<string>('defaultModel', row.model);
      AppStorage.setOrCreate<string>('defaultEffort', effort);
      this.toast('已保存');
    }).catch((error: Error) => {
      this.saving = false;
      this.savedModel = prevModel;
      this.savedProvider = prevProvider;
      this.savedEffort = prevEffort;
      AppStorage.setOrCreate<string>('defaultModel', prevDefaultModel);
      AppStorage.setOrCreate<string>('defaultEffort', prevDefaultEffort);
      PreferencesStore.get().putString('defaultModel', prevDefaultModel);
      PreferencesStore.get().putString('defaultEffort', prevDefaultEffort);
      Logger.warn('[MODEL] save default failed ' + error.message);
      this.toast('保存失败：' + (error.message.length > 0 ? error.message : '请稍后再试'));
    });
  }

  /** 点模型名：只切换模型（档位沿用该模型当前档位） */
  private pickModel(row: ModelRow): void {
    const effort: string = this.rows.length === 0 ? ''
      : (this.isCurrentModel(row) ? this.currentEffortOf(row) : row.defaultEffort);
    this.save(row, effort);
  }

  /** 思考等级 chip（对齐小程序 .model-effort-chip） */
  @Builder
  effortChip(row: ModelRow, option: EffortOption) {
    Text(option.name)
      .fontSize(12.3)
      .fontWeight(this.currentEffortOf(row) === option.id ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(this.currentEffortOf(row) === option.id ? '#FFFFFF' : this.textColor())
      .height(29)
      .padding({ left: 13, right: 13 })
      .textAlign(TextAlign.Center)
      .borderRadius(999)
      .backgroundColor(this.currentEffortOf(row) === option.id
        ? '#2E6BE6'
        : (this.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(16,19,24,0.055)'))
      .margin({ right: 8, bottom: 8 })
      .onClick(() => {
        this.save(row, option.id);
      })
  }

  /** 空态卡片（未连接 / 读取中 / 无可用模型） */
  @Builder
  stateCard(title: string, detail: string, withRetry: boolean) {
    Column({ space: 12 }) {
      Row({ space: 9 }) {
        if (!withRetry) {
          LoadingProgress()
            .width(16)
            .height(16)
            .color('#2E6BE6')
        }
        Text(title)
          .fontSize(15.5)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .width('100%')
      Text(detail)
        .fontSize(12.8)
        .lineHeight(19)
        .fontColor(this.subColor())
        .width('100%')
      if (withRetry) {
        Text('重新加载')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .width('100%')
          .height(40)
          .textAlign(TextAlign.Center)
          .borderRadius(12)
          .backgroundColor('#2E6BE6')
          .margin({ top: 2 })
          .onClick(() => {
            this.reload();
          })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(18)
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .border({ width: 1, color: this.cardEdge() })
  }

  /** 模型卡片：选中态高亮 + 名称行（点击切换）+ 思考等级 chips */
  @Builder
  modelCard(row: ModelRow) {
    Column({ space: 0 }) {
      Row({ space: 10 }) {
        Column({ space: 4 }) {
          Text(row.label)
            .fontSize(16.5)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.isCurrentModel(row)) {
            Text('当前使用')
              .fontSize(11)
              .fontWeight(FontWeight.Medium)
              .fontColor('#2E6BE6')
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (this.isCurrentModel(row)) {
          Text('✓')
            .fontSize(14)
            .fontWeight(FontWeight.Bold)
            .fontColor('#2E6BE6')
            .width(24)
            .height(24)
            .textAlign(TextAlign.Center)
            .borderRadius(12)
            .backgroundColor(this.isDark ? 'rgba(46,107,230,0.24)' : 'rgba(46,107,230,0.12)')
        }
      }
      .width('100%')

      if (row.efforts.length > 0) {
        Column({ space: 6 }) {
          Text('思考等级')
            .fontSize(11.6)
            .fontColor(this.subColor())
            .width('100%')
          Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Start }) {
            ForEach(row.efforts, (option: EffortOption) => {
              this.effortChip(row, option)
            }, (option: EffortOption) => row.provider + '-' + row.model + '-' + option.id)
          }
          .width('100%')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .margin({ top: 14 })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 15, bottom: 15 })
    .margin({ bottom: 10 })
    .borderRadius(16)
    .border({
      width: this.isCurrentModel(row) ? 1.2 : 1,
      color: this.isCurrentModel(row) ? '#2E6BE6' : this.cardEdge()
    })
    .backgroundColor(this.isCurrentModel(row)
      ? (this.isDark ? 'rgba(46,107,230,0.14)' : 'rgba(46,107,230,0.055)')
      : this.cardBg())
    // 整张卡片（含内边距与空白区）都可点：点一下即切换为该模型
    .onClick(() => {
      this.pickModel(row);
    })
  }

  build() {
    NavDestination() {
      Column() {
        // 导航：返回 + 居中标题（与「设置」「对话状态条」等二级页一致）
        Stack({ alignContent: Alignment.TopStart }) {
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })
          Text('默认模型')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)
          Row().width(44).height(44)
        }
        .width('100%')
        .height(56)
        .padding({ left: 18.7, right: 18.7 })
        .backdropBlur(12)
        }
        .width('100%')
        .zIndex(10)

        Scroll() {
          Column() {
            this.introCard()

            if (this.connection !== 'connected') {
              this.stateCard('未连接网关', '连接网关后自动读取模型目录与思考等级。', true)
            } else if (this.loading && this.rows.length === 0) {
              this.stateCard('正在读取模型…', '正在从网关拉取模型目录与思考等级。', false)
            } else if (this.rows.length === 0) {
              this.stateCard('暂无可用模型', '网关未返回模型目录，可稍后重新加载。', true)
            } else {
              ForEach(this.groupedRows(), (group: ModelGroupVm) => {
                Column({ space: 0 }) {
                  // 提供商标题行（分组小标题）
                  Text(group.title)
                    .fontSize(12.4)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.subColor())
                    .width('100%')
                    .padding({ left: 4, top: 18, bottom: 8 })

                  ForEach(group.items, (row: ModelRow) => {
                    this.modelCard(row)
                  }, (row: ModelRow) => row.provider + '|' + row.model)
                }
                .width('100%')
              }, (group: ModelGroupVm) => group.title)

              Text('保存在网关 · 自动同步 WebUI')
                .fontSize(12.2)
                .fontColor(this.isDark ? 'rgba(241,244,250,0.34)' : 'rgba(16,19,24,0.34)')
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 14, bottom: 30 })
            }
          }
          .width('100%')
          .padding({ left: 18.7, right: 18.7 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        // 不要用「padding + 负 margin」补位：负 margin 会让渲染位置与点按区域错开，
        // 表现为点模型没反应/点错行。导航在 Stack 里独立占 56，内容自然排在它下面。
        .align(Alignment.Top)
        .edgeEffect(EdgeEffect.None)
      }
      .width('100%')
      .height('100%')
      .padding({ top: this.topInset() })
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
