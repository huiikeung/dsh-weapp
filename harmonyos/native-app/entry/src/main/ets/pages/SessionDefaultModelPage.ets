import { asRec, GatewayClient, GatewayFrame, GatewayRequestFactory, SessionStore } from 'nativecore';
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

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
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
    const sessionId: string = SessionStore.get().currentSessionId();
    const request = sessionId.length > 0
      ? GatewayRequestFactory.make('models', 'models', { 'sessionId': sessionId }, sessionId)
      : GatewayRequestFactory.simple('models');
    client.requestGateway(request, 15000).then((frame: GatewayFrame) => {
      this.loading = false;
      this.loaded = true;
      this.rows = this.parseCatalog(frame);
    }).catch((error: Error) => {
      this.loading = false;
      this.rows = [];
      this.toast('模型目录加载失败');
    });
  }

  private parseCatalog(frame: GatewayFrame): ModelRow[] {
    const rec = asRec(frame) ?? ({} as Record<string, Object>);
    const rawGroups = rec['groups'];
    const groups = rawGroups !== undefined && Array.isArray(rawGroups) ? rawGroups as Object[] : [];
    // 权威当前模型/档位（网关帧 current），回退本地 AppStorage 默认值
    let currentModel: string = this.defaultModelValue;
    let currentProvider: string = this.savedProvider;
    let currentEffort: string = this.defaultEffortValue;
    const rawCurrent = rec['current'];
    if (rawCurrent !== undefined && !Array.isArray(rawCurrent)) {
      const cur = rawCurrent as Record<string, Object>;
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
    }
    const rows: ModelRow[] = [];
    for (const group of groups) {
      const g = group as Record<string, Object>;
      const provider: string = String(g['provider'] ?? '');
      const rawModels = g['models'];
      if (rawModels === undefined || !Array.isArray(rawModels)) {
        continue;
      }
      for (const one of rawModels as Object[]) {
        const m = one as Record<string, Object>;
        const row: ModelRow = new ModelRow();
        row.provider = provider;
        row.model = String(m['id'] ?? '');
        const name: string = String(m['name'] ?? '');
        row.label = name.length > 0 ? name : row.model;
        const de = m['defaultEffort'];
        row.defaultEffort = de === undefined ? '' : String(de);
        const reasoning = m['reasoning'] as Record<string, Object> | undefined;
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
    // 提供商显示名（网关 groups 里可能只有 provider id，回退用 id）
    this.providerTitles = new Map<string, string>();
    for (const group of groups) {
      const g = group as Record<string, Object>;
      const provider: string = String(g['provider'] ?? '');
      const pn: string = String(g['providerName'] ?? '');
      this.providerTitles.set(provider, pn.length > 0 ? pn : provider);
    }
    this.savedModel = currentModel;
    this.savedProvider = currentProvider;
    this.savedEffort = currentEffort;
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
  private isCurrentModel(row: ModelRow): boolean {
    const model: string = this.savedModel.length > 0 ? this.savedModel : this.defaultModelValue;
    if (model.length === 0 || model !== row.model) {
      return false;
    }
    const provider: string = this.savedProvider;
    return provider.length === 0 || provider === row.provider;
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
    const request = GatewayRequestFactory.make('save-default-model', 'save-default-model',
      { 'provider': row.provider, 'model': row.model, 'reasoningEffort': effort });
    GatewayClient.get().requestGateway(request, 15000).then((frame: GatewayFrame) => {
      this.saving = false;
      this.savedModel = row.model;
      this.savedProvider = row.provider;
      this.savedEffort = effort;
      this.toast('已保存');
    }).catch((error: Error) => {
      this.saving = false;
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
      .fontSize(12.5)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.currentEffortOf(row) === option.id ? '#FFFFFF' : this.textColor())
      .padding({ left: 11, right: 11, top: 5.5, bottom: 5.5 })
      .borderRadius(999)
      .backgroundColor(this.currentEffortOf(row) === option.id
        ? '#2E6BE6'
        : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)'))
      .margin({ right: 12, bottom: 8 })
      .onClick(() => {
        this.save(row, option.id);
      })
  }

  /** 空态卡片（未连接 / 读取中 / 无可用模型） */
  @Builder
  stateCard(title: string, detail: string, withRetry: boolean) {
    Column({ space: 10 }) {
      Text(title)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(detail)
        .fontSize(13)
        .lineHeight(19.5)
        .fontColor(this.subColor())
      if (withRetry) {
        Text('重新加载')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor('#2E6BE6')
          .width('100%')
          .height(38)
          .textAlign(TextAlign.Center)
          .borderRadius(10)
          .border({ width: 0.5, color: '#2E6BE6' })
          .margin({ top: 4 })
          .onClick(() => {
            this.reload();
          })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .borderRadius(14)
    .backgroundColor(this.cardBg())
    .border({ width: 0.5, color: this.dividerColor() })
  }

  /** 单个模型卡片：名称行 + 「思考等级」常显档位（对齐小程序 model-option-card） */
  @Builder
  modelCard(row: ModelRow) {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Text(row.label)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.isCurrentModel(row)) {
          Text('当前使用')
            .fontSize(10.5)
            .fontColor('#2E6BE6')
            .backgroundColor(this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
            .borderRadius(4)
            .padding({ left: 5, right: 5, top: 2, bottom: 2 })
        }
      }
      .width('100%')
      .onClick(() => {
        this.pickModel(row);
      })

      // 思考等级：常显（对齐小程序 model-effort-section）
      if (row.efforts.length > 0) {
        Column({ space: 8 }) {
          Text('思考等级')
            .fontSize(12)
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
        .margin({ top: 12 })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .margin({ bottom: 9.4 })
    .borderRadius(14)
    .border({
      width: 1,
      color: this.isCurrentModel(row) ? '#6B87D7' : this.dividerColor()
    })
    .backgroundColor(this.isCurrentModel(row)
      ? (this.isDark ? 'rgba(83,112,198,0.14)' : 'rgba(83,112,198,0.06)')
      : this.cardBg())
  }

  build() {
    NavDestination() {
      Column() {
        // 导航：返回 + 居中标题（与「设置」「对话状态条」等二级页一致）
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

        Scroll() {
          Column() {
            Text('为之后新建的会话设置默认模型与思考等级。这会更新部署级设置，同步影响 WebUI，运行中的会话保持启动时的配置。')
              .fontSize(14)
              .lineHeight(20)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ bottom: 14 })

            if (this.connection !== 'connected') {
              this.stateCard('未连接网关', '连接网关后自动读取模型目录与思考等级。', true)
            } else if (this.loading && this.rows.length === 0) {
              this.stateCard('正在读取模型…', '正在从网关拉取模型目录与思考等级。', false)
            } else if (this.rows.length === 0) {
              this.stateCard('暂无可用模型', '网关未返回模型目录，可稍后重新加载。', true)
            } else {
              ForEach(this.groupedRows(), (group: ModelGroupVm) => {
                Column({ space: 0 }) {
                  // 提供商标题行（对齐小程序 .picker-provider-title）
                  Text(group.title)
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .width('100%')
                    .padding({ left: 4, top: 10, bottom: 6 })

                  ForEach(group.items, (row: ModelRow) => {
                    this.modelCard(row)
                  }, (row: ModelRow) => row.provider + '|' + row.model)
                }
                .width('100%')
              }, (group: ModelGroupVm) => group.title)

              Text('保存在网关 · 自动同步 WebUI')
                .fontSize(12.9)
                .fontColor(this.subColor())
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 9, bottom: 24 })
            }
          }
          .width('100%')
          .padding({ left: 18.7, right: 18.7 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
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
