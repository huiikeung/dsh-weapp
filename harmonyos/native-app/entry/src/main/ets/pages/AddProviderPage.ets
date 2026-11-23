import {
  GatewayClient, GatewayFrame, PI_NS, PI_PREFIX, PROVIDER_PROTOCOLS, ProviderConfigDraft, ProviderProtocol,
  asRec, buildProviderConfig, credentialRefFor, formatTokenCount, isValidProviderBaseURL, parseNamespace,
  providerCreateMutation, validateProviderId
} from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';

/** 内置目录里的提供商候选 */
class ProviderOption {
  id: string = '';
  name: string = '';
  baseURL: string = '';
}

/** 自动发现到的模型行 */
class DiscoveryRow {
  id: string = '';
  name: string = '';
  meta: string = '';
  selected: boolean = false;
}

/**
 * 添加模型提供商（功能 → 模型 → 添加模型提供商）。
 *
 * 内容与版式对齐小程序 pages/models 的「添加模型提供商」面板：
 *   模式切换（第三方模型提供商 / 自定义模型 API）→ 目录搜索选择 或 API 字段
 *   → 「自动获取模型」（从端点拉取、勾选批量添加）→ API Key → 底部 取消/添加。
 * 卡片底色使用页面背景色（靠细描边 + 柔和投影分层），不再用白色玻璃底。
 */
@Component
export struct AddProviderPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('connectionState') connection: string = 'disconnected';

  @State mode: string = 'catalog';
  @State loading: boolean = true;
  @State loadError: string = '';
  @State catalog: ProviderOption[] = [];
  @State catalogQuery: string = '';
  @State selectedId: string = '';
  /** 内置目录没有默认接口地址时允许手填（如 step） */
  @State catalogBaseURL: string = '';
  @State providerId: string = '';
  @State displayName: string = '';
  @State baseURL: string = '';
  @State api: string = 'openai-completions';
  @State apiKey: string = '';
  @State discoverLoading: boolean = false;
  @State discoverError: string = '';
  @State discoverRows: DiscoveryRow[] = [];
  @State discoverQuery: string = '';
  @State manualModels: string = '';
  @State showManual: boolean = false;
  @State busy: boolean = false;
  @State error: string = '';
  private configuredIds: string[] = [];

  aboutToAppear(): void {
    this.load();
  }

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  /** 卡片底 = 页面背景色，靠描边区分层次 */
  private cardBg(): string {
    return this.pageBg();
  }

  /** 卡片边框 = 返回按钮同款（浅色白 90%、深色白 16%，1vp） */
  private cardEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
  }

  /** 按钮/选中态用的淡蓝底（替代原来的灰底，避免突兀） */
  private accentFill(): string {
    return this.isDark ? 'rgba(46,107,230,0.24)' : 'rgba(46,107,230,0.10)';
  }

  private accentEdge(): string {
    return this.isDark ? 'rgba(46,107,230,0.45)' : 'rgba(46,107,230,0.28)';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.52)';
  }

  private fillColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.045)';
  }

  private fillStrong(): string {
    return this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.07)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.09)' : 'rgba(16,19,24,0.07)';
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
    } catch (ignored) {
    }
  }

  private isEmpty(value: string): boolean {
    return value.trim().length === 0;
  }

  /** 当前生效的 provider 描述（catalog 模式取选中项，custom 模式取输入） */
  private activeProviderId(): string {
    if (this.mode === 'catalog') {
      return this.selectedId;
    }
    return this.providerId.trim();
  }

  private activeBaseURL(): string {
    if (this.mode === 'catalog') {
      const manual: string = this.catalogBaseURL.trim();
      if (manual.length > 0) {
        return manual;
      }
      for (const option of this.catalog) {
        if (option.id === this.selectedId) {
          return option.baseURL;
        }
      }
      return '';
    }
    return this.baseURL.trim();
  }

  private activeApi(): string {
    return this.mode === 'catalog' ? '' : this.api;
  }

  /** 读取内置目录（providers 帧）与已配置提供商。 */
  private load(): void {
    this.loading = true;
    this.loadError = '';
    const client: GatewayClient = GatewayClient.get();
    if (this.connection !== 'connected') {
      this.loading = false;
      this.loadError = '请先连接鲸尾 Harness';
      return;
    }
    client.requestProviders().then((frame: GatewayFrame) => {
      const data = asRec(frame);
      const raw: Object | undefined = data === undefined ? undefined : data['providers'];
      const candidates: ProviderOption[] = [];
      if (raw !== undefined && Array.isArray(raw)) {
        for (const one of raw as Object[]) {
          const rec = one as Record<string, Object>;
          const settingsNs = String(rec['settingsNs'] ?? '');
          const settingsPath = rec['settingsPath'];
          if (settingsNs !== PI_NS || settingsPath === undefined || !Array.isArray(settingsPath)) {
            continue;
          }
          const path = settingsPath as Object[];
          if (path.length !== 2 || String(path[0]) !== PI_PREFIX) {
            continue;
          }
          if (rec['declared'] === true) {
            continue;
          }
          const option = new ProviderOption();
          option.id = String(rec['provider'] ?? '');
          if (option.id.length === 0) {
            continue;
          }
          const name = String(rec['displayName'] ?? '');
          option.name = name.length > 0 ? name : option.id;
          option.baseURL = String(rec['defaultBaseURL'] ?? '');
          candidates.push(option);
        }
      }
      return client.requestPluginSettings(PI_NS).then((nsFrame: GatewayFrame) => {
        const ns = parseNamespace(nsFrame);
        const value = ns.value;
        const configured = value !== undefined ? (value as Record<string, Object>)['providers'] : undefined;
        const configuredIds: string[] = [];
        if (configured !== undefined) {
          for (const key of Object.keys(configured as Record<string, Object>)) {
            configuredIds.push(key);
          }
        }
        this.configuredIds = configuredIds;
        const remaining: ProviderOption[] = [];
        for (const option of candidates) {
          if (configuredIds.indexOf(option.id) < 0) {
            remaining.push(option);
          }
        }
        this.catalog = remaining;
        this.loading = false;
      });
    }).catch((err: Error) => {
      this.loading = false;
      this.loadError = err.message.length > 0 ? err.message : '无法读取提供商目录';
    });
  }

  private catalogVisible(): ProviderOption[] {
    const query = this.catalogQuery.trim().toLowerCase();
    if (query.length === 0) {
      return this.catalog;
    }
    const rows: ProviderOption[] = [];
    for (const option of this.catalog) {
      if (option.id.toLowerCase().indexOf(query) >= 0 || option.name.toLowerCase().indexOf(query) >= 0) {
        rows.push(option);
      }
    }
    return rows;
  }

  private discoverVisible(): DiscoveryRow[] {
    const query = this.discoverQuery.trim().toLowerCase();
    if (query.length === 0) {
      return this.discoverRows;
    }
    const rows: DiscoveryRow[] = [];
    for (const row of this.discoverRows) {
      if (row.id.toLowerCase().indexOf(query) >= 0 || row.name.toLowerCase().indexOf(query) >= 0) {
        rows.push(row);
      }
    }
    return rows;
  }

  private selectedCount(): number {
    let count = 0;
    for (const row of this.discoverRows) {
      if (row.selected) {
        count += 1;
      }
    }
    return count;
  }

  private toggleSelectAll(): void {
    const visible = this.discoverVisible();
    let allSelected = visible.length > 0;
    for (const row of visible) {
      if (!row.selected) {
        allSelected = false;
      }
    }
    for (const row of visible) {
      row.selected = !allSelected;
    }
    this.discoverRows = this.discoverRows.slice();
  }

  /** 从提供商端点自动获取模型（llm-discover-models，对齐小程序 runProviderDiscovery）。 */
  private runDiscovery(): void {
    if (this.discoverLoading) {
      return;
    }
    this.discoverError = '';
    const provider = this.activeProviderId();
    if (provider.length === 0) {
      this.discoverError = '请先选择或填写提供商';
      return;
    }
    const payload: Record<string, Object> = {
      'requestId': 'llm-discover-' + Date.now().toString(),
      'ns': PI_NS,
      'provider': provider
    };
    const baseURL = this.activeBaseURL();
    if (baseURL.length > 0) {
      payload['baseURL'] = baseURL;
    }
    const api = this.activeApi();
    if (api.length > 0) {
      payload['api'] = api;
    }
    const apiKey = this.apiKey.trim();
    if (apiKey.length > 0) {
      payload['apiKey'] = apiKey;
    }
    this.discoverLoading = true;
    GatewayClient.get().requestPlugin('llm-discover-models', payload, 25000).then((frame: GatewayFrame) => {
      const data = asRec(frame);
      const raw: Object | undefined = data === undefined ? undefined : data['models'];
      const rows: DiscoveryRow[] = [];
      if (raw !== undefined && Array.isArray(raw)) {
        for (const one of raw as Object[]) {
          const rec = one as Record<string, Object>;
          const row = new DiscoveryRow();
          row.id = String(rec['id'] ?? '');
          if (row.id.length === 0) {
            continue;
          }
          const name = String(rec['name'] ?? '');
          row.name = name.length > 0 ? name : row.id;
          const parts: string[] = [];
          const context = Number(rec['contextWindow'] ?? 0);
          if (context > 0) {
            parts.push('上下文 ' + formatTokenCount(context));
          }
          const maxTokens = Number(rec['maxTokens'] ?? 0);
          if (maxTokens > 0) {
            parts.push('输出 ' + formatTokenCount(maxTokens));
          }
          const modalities = rec['inputModalities'];
          if (modalities !== undefined && Array.isArray(modalities)) {
            const labels: string[] = [];
            for (const modality of modalities as Object[]) {
              const key = String(modality);
              if (key === 'text') {
                labels.push('文本');
              } else if (key === 'image') {
                labels.push('图片');
              }
            }
            if (labels.length > 0) {
              parts.push(labels.join('/'));
            }
          }
          row.meta = parts.join(' · ');
          rows.push(row);
        }
      }
      this.discoverRows = rows;
      this.discoverLoading = false;
      if (rows.length === 0) {
        this.discoverError = '该端点没有返回可用模型';
      }
    }).catch((err: Error) => {
      this.discoverLoading = false;
      this.discoverError = err.message.length > 0 ? err.message : '获取模型失败，请检查接口地址 / API Key';
    });
  }

  private pickCatalog(option: ProviderOption): void {
    this.selectedId = option.id;
    this.catalogBaseURL = option.baseURL;
    this.discoverRows = [];
    this.discoverQuery = '';
    this.discoverError = '';
    this.runDiscovery();
  }

  private parsedManualModels(): Object[] {
    const models: Object[] = [];
    const seen: string[] = [];
    for (const line of this.manualModels.split('\n')) {
      const id = line.trim();
      if (id.length === 0 || seen.indexOf(id) >= 0) {
        continue;
      }
      seen.push(id);
      models.push({ 'id': id } as Record<string, Object>);
    }
    return models;
  }

  private pickedModels(): Object[] {
    const models: Object[] = [];
    const seen: string[] = [];
    for (const row of this.discoverRows) {
      if (!row.selected || seen.indexOf(row.id) >= 0) {
        continue;
      }
      seen.push(row.id);
      models.push({ 'id': row.id, 'name': row.name } as Record<string, Object>);
    }
    for (const manual of this.parsedManualModels()) {
      const id = String((manual as Record<string, Object>)['id']);
      if (seen.indexOf(id) >= 0) {
        continue;
      }
      seen.push(id);
      models.push(manual);
    }
    return models;
  }

  private submit(): void {
    if (this.busy) {
      return;
    }
    this.error = '';
    let providerId = this.providerId.trim();
    let displayName = this.displayName.trim();
    let baseURL = this.baseURL.trim();
    let api = this.api;
    if (this.mode === 'catalog') {
      let picked: ProviderOption | undefined = undefined;
      for (const option of this.catalog) {
        if (option.id === this.selectedId) {
          picked = option;
          break;
        }
      }
      if (picked === undefined) {
        this.error = '请选择一个提供商';
        return;
      }
      providerId = picked.id;
      baseURL = this.activeBaseURL();
      if (displayName.length === 0) {
        displayName = picked.name;
      }
      api = '';
    } else {
      const idError: string = validateProviderId(providerId, this.configuredIds);
      if (idError.length > 0) {
        this.error = idError;
        return;
      }
      if (!isValidProviderBaseURL(baseURL)) {
        this.error = '接口地址必须是 http(s) 绝对地址';
        return;
      }
      let apiValid = false;
      for (const protocol of PROVIDER_PROTOCOLS) {
        if (protocol.id === api) {
          apiValid = true;
        }
      }
      if (!apiValid) {
        this.error = '请选择 API 协议';
        return;
      }
    }
    const models = this.pickedModels();
    if (models.length === 0) {
      this.error = '请先「获取可用模型」并勾选至少一个模型（或手动填写模型 ID）';
      return;
    }
    const apiKey = this.apiKey.trim();
    const draft: ProviderConfigDraft = {
      displayName: displayName,
      api: api,
      baseURL: baseURL,
      apiKeyEnv: apiKey.length > 0 ? credentialRefFor(providerId) : '',
      models: models
    };
    const config = buildProviderConfig(draft);
    const client: GatewayClient = GatewayClient.get();
    this.busy = true;
    client.requestPluginSettings(PI_NS).then((nsFrame: GatewayFrame) => {
      const ns = parseNamespace(nsFrame);
      if (!ns.valid) {
        throw new Error('当前网关未提供模型配置，请升级网关后重试。');
      }
      const ops = providerCreateMutation(providerId, config, ns.revision);
      return client.mutatePluginSettings(PI_NS, ns.revision, ops);
    }).then((): Promise<string> => {
      if (apiKey.length === 0) {
        return Promise.resolve('');
      }
      return client.requestPlugin('model-credential-set',
        { 'requestId': 'model-credential-' + Date.now().toString(), 'ref': credentialRefFor(providerId), 'value': apiKey }, 20000)
        .then((): string => '').catch((credentialError: Error): string => {
          return credentialError.message.length > 0 ? credentialError.message : '写入失败';
        });
    }).then((credentialError: string) => {
      this.busy = false;
      client.requestModelsCatalog();
      if (credentialError.length > 0) {
        this.toast('提供商已添加，但 API Key 写入失败：' + credentialError);
      } else {
        this.toast('模型提供商已添加');
      }
      this.pageStack.pop();
    }).catch((err: Error) => {
      this.busy = false;
      this.error = err.message.length > 0 ? err.message : '保存失败，请重试';
    });
  }

  // ==================== 小程序风格的原子 ====================

  @Builder
  fieldLabel(text: string) {
    Text(text)
      .fontSize(12)
      .fontColor(this.subColor())
      .width('100%')
      .margin({ bottom: 5 })
  }

  @Builder
  fieldHint(text: string) {
    Text(text)
      .fontSize(11)
      .lineHeight(16.5)
      .fontColor(this.subColor())
      .width('100%')
      .margin({ top: 5 })
  }

  @Builder
  fieldInput(value: string, placeholder: string, password: boolean, onChange: (value: string) => void) {
    if (password) {
      TextInput({ text: value, placeholder: placeholder })
        .type(InputType.Password)
        .fontSize(14.5)
        .fontColor(this.textColor())
        .placeholderColor(this.subColor())
        .backgroundColor(this.fillColor())
        .borderRadius(8)
        .height(42)
        .padding({ left: 12, right: 12 })
        .onChange((next: string) => {
          onChange(next);
        })
    } else {
      TextInput({ text: value, placeholder: placeholder })
        .fontSize(14.5)
        .fontColor(this.textColor())
        .placeholderColor(this.subColor())
        .backgroundColor(this.fillColor())
        .borderRadius(8)
        .height(42)
        .padding({ left: 12, right: 12 })
        .onChange((next: string) => {
          onChange(next);
        })
    }
  }

  @Builder
  modeTabs() {
    Row({ space: 4 }) {
      Text('第三方模型提供商')
        .fontSize(13.5)
        .fontWeight(this.mode === 'catalog' ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.mode === 'catalog' ? '#2E6BE6' : this.subColor())
        .height(34)
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
        .borderRadius(999)
        .backgroundColor(this.mode === 'catalog' ? this.accentFill() : Color.Transparent)
        .onClick(() => {
          this.mode = 'catalog';
        })
      Text('自定义模型 API')
        .fontSize(13.5)
        .fontWeight(this.mode === 'custom' ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.mode === 'custom' ? '#2E6BE6' : this.subColor())
        .height(34)
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
        .borderRadius(999)
        .backgroundColor(this.mode === 'custom' ? this.accentFill() : Color.Transparent)
        .onClick(() => {
          this.mode = 'custom';
        })
    }
    .width('100%')
    .padding(4)
    .borderRadius(999)
    .backgroundColor(this.fillColor())
  }

  @Builder
  catalogBlock() {
    Column({ space: 10 }) {
      this.fieldLabel('提供商')
      this.fieldInput(this.catalogQuery, '搜索内置提供商', false, (value: string) => {
        this.catalogQuery = value;
      })
      if (this.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(15).height(15).color(this.subColor())
          Text('正在读取提供商目录…').fontSize(13).fontColor(this.subColor())
        }
        .width('100%')
        .padding({ top: 6 })
      } else if (this.loadError.length > 0) {
        Text(this.loadError).fontSize(12.6).fontColor('#D4545B').width('100%')
      } else if (this.catalogVisible().length === 0) {
        Text('没有匹配的提供商').fontSize(12.6).fontColor(this.subColor()).width('100%')
      } else {
        Scroll() {
          Column({ space: 0 }) {
            ForEach(this.catalogVisible(), (option: ProviderOption) => {
              Row({ space: 10 }) {
                Row() {
                  if (this.selectedId === option.id) {
                    Text('●').fontSize(11).fontColor('#2E6BE6')
                  }
                }
                .width(16)
                .height(16)
                Column({ space: 2 }) {
                  Text(option.name)
                    .fontSize(14.5)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Text(option.id)
                    .fontSize(11)
                    .fontColor(this.subColor())
                  if (option.baseURL.length > 0) {
                    Text(option.baseURL)
                      .fontSize(11)
                      .fontColor(this.subColor())
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
              .padding({ left: 12, right: 12, top: 10, bottom: 10 })
              .borderRadius(10)
              .backgroundColor(this.selectedId === option.id ? this.accentFill() : Color.Transparent)
              .onClick(() => {
                this.pickCatalog(option);
              })
            }, (option: ProviderOption) => option.id)
          }
          .width('100%')
        }
        .width('100%')
        .height(220)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        .edgeEffect(EdgeEffect.None)
      }
      Column() {
        this.fieldLabel('接口地址（可选）')
        this.fieldInput(this.catalogBaseURL, '内置目录无默认地址时需填写，例如 https://api.example.com/v1', false, (value: string) => {
          this.catalogBaseURL = value;
        })
        this.fieldHint('没有内置模型目录的提供商（如 step）必须填写接口地址，否则无法获取模型。')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column() {
        this.fieldLabel('API Key（可选）')
        this.fieldInput(this.apiKey, '留空则使用原生认证或环境变量', true, (value: string) => {
          this.apiKey = value;
        })
        this.fieldHint('原生认证环境变量由 pi-ai provider 自带；填写后会写成 <ROUTE>_API_KEY 凭据。')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  customBlock() {
    Column({ space: 14 }) {
      Column() {
        this.fieldLabel('Provider ID')
        this.fieldInput(this.providerId, '唯一标识，例如 my-relay', false, (value: string) => {
          this.providerId = value;
        })
        this.fieldHint('小写字母开头，只能包含小写字母、数字和连字符')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column() {
        this.fieldLabel('显示名称（可选）')
        this.fieldInput(this.displayName, '显示名称（可选）', false, (value: string) => {
          this.displayName = value;
        })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column() {
        this.fieldLabel('API 协议')
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(PROVIDER_PROTOCOLS, (protocol: ProviderProtocol) => {
            Text(protocol.label)
              .fontSize(12.3)
              .fontWeight(this.api === protocol.id ? FontWeight.Medium : FontWeight.Normal)
              .fontColor(this.api === protocol.id ? '#FFFFFF' : this.textColor())
              .height(30)
              .padding({ left: 13, right: 13 })
              .textAlign(TextAlign.Center)
              .borderRadius(999)
              .backgroundColor(this.api === protocol.id
                ? '#2E6BE6'
                : (this.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(16,19,24,0.055)'))
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.api = protocol.id;
              })
          }, (protocol: ProviderProtocol) => protocol.id)
        }
        .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column() {
        this.fieldLabel('接口地址')
        this.fieldInput(this.baseURL, 'https://gateway.example/v1', false, (value: string) => {
          this.baseURL = value;
        })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column() {
        this.fieldLabel('API Key（可选）')
        this.fieldInput(this.apiKey, '留空则使用原生认证或环境变量', true, (value: string) => {
          this.apiKey = value;
        })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 自动获取模型：从端点拉取可用模型，勾选后批量添加（对齐小程序 discovery-panel） */
  @Builder
  discoveryPanel() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Column({ space: 3 }) {
          Text('自动获取模型')
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.subColor())
          Text('从提供商端点读取可用模型，勾选后批量添加。')
            .fontSize(11)
            .fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text(this.discoverLoading ? '正在获取…' : '获取可用模型')
          .fontSize(12.5)
          .fontWeight(FontWeight.Medium)
          .fontColor('#2E6BE6')
          .height(32)
          .padding({ left: 12, right: 12 })
          .textAlign(TextAlign.Center)
          .borderRadius(999)
          .backgroundColor(this.accentFill())
          .border({ width: 1, color: this.accentEdge() })
          .onClick(() => {
            this.runDiscovery();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.discoverError.length > 0) {
        Text(this.discoverError).fontSize(11.5).fontColor('#D4545B').width('100%')
      }

      if (this.discoverRows.length > 0) {
        this.fieldInput(this.discoverQuery, '搜索模型', false, (value: string) => {
          this.discoverQuery = value;
        })
        Row() {
          Text(this.selectedCount().toString() + ' 个已选择')
            .fontSize(11.5)
            .fontColor(this.subColor())
          Blank()
          Text('全选/取消全选')
            .fontSize(11.5)
            .fontColor('#2E6BE6')
            .onClick(() => {
              this.toggleSelectAll();
            })
        }
        .width('100%')
        .padding({ top: 2, bottom: 2 })

        Scroll() {
          Column({ space: 0 }) {
            ForEach(this.discoverVisible(), (row: DiscoveryRow) => {
              Row({ space: 10 }) {
                Text(row.selected ? '✓' : '')
                  .fontSize(11)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(row.selected ? '#FFFFFF' : this.subColor())
                  .width(18)
                  .height(18)
                  .textAlign(TextAlign.Center)
                  .borderRadius(9)
                  .border({ width: 1, color: row.selected ? '#2E6BE6' : (this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(16,19,24,0.16)') })
                  .backgroundColor(row.selected ? '#2E6BE6' : Color.Transparent)
                Column({ space: 2 }) {
                  Text(row.name)
                    .fontSize(13.5)
                    .fontColor(this.textColor())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (row.meta.length > 0) {
                    Text(row.meta)
                      .fontSize(11)
                      .fontColor(this.subColor())
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
              .padding({ top: 8, bottom: 8 })
              .onClick(() => {
                row.selected = !row.selected;
                this.discoverRows = this.discoverRows.slice();
              })
            }, (row: DiscoveryRow) => row.id)
          }
          .width('100%')
        }
        .width('100%')
        .height(180)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        .edgeEffect(EdgeEffect.None)
      }

      Row() {
        Text(this.showManual ? '收起手动填写模型 ID' : '手动填写模型 ID')
          .fontSize(11.5)
          .fontColor('#2E6BE6')
          .onClick(() => {
            this.showManual = !this.showManual;
          })
      }
      .width('100%')
      .padding({ top: 2 })

      if (this.showManual) {
        Column() {
          this.fieldLabel('模型 ID（每行一个）')
          TextArea({ text: this.manualModels, placeholder: 'deepseek-v4-flash\nmy-model-id' })
            .fontSize(13.5)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(this.fillColor())
            .borderRadius(8)
            .height(88)
            .padding(12)
            .onChange((value: string) => {
              this.manualModels = value;
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(12)
    .borderRadius(12)
    .backgroundColor(this.fillColor())
  }

  @Builder
  actionsRow() {
    Row({ space: 10 }) {
      Text('取消')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.subColor())
        .layoutWeight(1)
        .height(46)
        .textAlign(TextAlign.Center)
        .borderRadius(12)
        .backgroundColor(Color.Transparent)
        .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.12)' })
        .onClick(() => {
          this.pageStack.pop();
        })
      Text(this.busy ? '正在保存…' : '添加提供商')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.busy ? this.subColor() : '#2E6BE6')
        .layoutWeight(1.6)
        .height(46)
        .textAlign(TextAlign.Center)
        .borderRadius(12)
        .backgroundColor(this.busy ? this.fillColor() : this.accentFill())
        .border({ width: 1, color: this.busy ? this.cardEdge() : this.accentEdge() })
        .opacity(this.busy ? 0.6 : 1)
        .onClick(() => {
          this.submit();
        })
    }
    .width('100%')
  }

  build() {
    NavDestination() {
      Column() {
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })
          Text('添加模型提供商')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)
          Row().width(40).height(40)
        }
        .width('100%')
        .height(56)
        .padding({ left: 18.7, right: 18.7 })

        Scroll() {
          Column({ space: 12 }) {
            Text('提供商配置会写入 DSH 的 llm-pi-ai 设置，与 DSH 客户端、WebUI 双向同步。')
              .fontSize(12.2)
              .lineHeight(18)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 2, right: 2 })

            Column({ space: 12 }) {
              this.modeTabs()
              if (this.mode === 'catalog') {
                this.catalogBlock()
              } else {
                this.customBlock()
              }
              this.discoveryPanel()

              if (this.error.length > 0) {
                Text(this.error)
                  .fontSize(12.6)
                  .fontColor('#D4545B')
                  .width('100%')
              }
              this.actionsRow()
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding(14)
            .borderRadius(16)
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.cardEdge() })

            Text('保存在网关 · 自动同步 WebUI')
              .fontSize(12)
              .fontColor(this.isDark ? 'rgba(241,244,250,0.34)' : 'rgba(16,19,24,0.34)')
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding({ top: 2, bottom: 30 })
          }
          .width('100%')
          .padding({ left: 18.7, right: 18.7, top: 2 })
          .alignItems(HorizontalAlign.Start)
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
