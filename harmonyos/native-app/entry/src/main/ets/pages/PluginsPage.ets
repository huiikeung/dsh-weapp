import { HdsNavDestination, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { currentGlassLevel, currentGlassMaterialLevel } from '../common/GlassMaterial';
import { uiMaterial } from '@kit.ArkUI';
import { GatewayClient, Logger, OfficialPluginItem, PluginItem, parseNamespace } from 'nativecore';
import type { CatalogEntry, CatalogRow } from 'nativecore';
import { MarkdownBodyView } from '../components/MarkdownBodyView';
import type { PluginNamespace } from 'nativecore';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

const MORE_BUNDLES: string[] = [
  'dsh-experimental-tool-worktree',
  'dsh-experimental-cot-translation-bundle',
  'dsh-experimental-terminal-bundle',
  'dsh-experimental-session-search',
  'dsh-experimental-session-titles-bundle',
  'dsh-experimental-badge-skill-bundle',
  'dsh-experimental-ralph-bundle',
  'dsh-experimental-plugin-market-bundle',
  'dsh-subagent-codex',
  'dsh-subagent-claude-code'
];

interface MarketIndex {
  label: string;
  url: string;
  error: string;
  /** 主机索引元数据里的描述（对齐 dsh 端：标题 + 描述） */
  description: string;
}

interface EntryRow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** 次行：组件 id · 模块名（对齐 dsh 端组件行） */
  moduleLine: string;
  /** 运行相位：active/failed/loading/unloading/pending/'' */
  phase: string;
  /** 所属包名（如 @deepseek-ai/dsh-experimental-xxx） */
  packageName: string;
}

interface SettingsOp {
  op: string;
  path: Object[];
  value: Object;
}

interface PluginField {
  ns: string;
  key: string;
  label: string;
  hint: string;
  numeric: boolean;
  value: string;
  revision: number;
}

/** 安装源选项（对齐小程序 registryOptions） */
interface RegistryOption {
  label: string;
  value: string;
}

interface MarketCategory {
  id: string;
  title: string;
}

interface MarketEntry {
  name: string;
  title: string;
  description: string;
  version: string;
  installLabel: string;
  /** 插件图标：索引元数据自带 icon，否则用 GitHub 仓库主头像（owner/repo → github.com/owner.png） */
  iconUrl: string;
  /** 图标加载失败后回退到默认图形 */
  iconFailed: boolean;
  /** 详情「来源」区（对齐 dsh 端插件详情） */
  homepage: string;
  repository: string;
  packageSpec: string;
  publishDate: string;
  categoryId: string;
  installed: boolean;
}

@Component
export struct PluginsPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('pluginBundles') bundles: PluginItem[] = [];
  @StorageLink('pluginOfficialItems') officialItems: OfficialPluginItem[] = [];
  @StorageLink('pluginManagementAvailable') managementAvailable: boolean = false;
  /** 实时映射：dsh 端设置/插件变化 → 静默刷新打开中的详情 */
  @StorageLink('pluginSettingsRevision') @Watch('onSettingsRevChanged') settingsRevision: number = 0;
  @StorageLink('pluginCatalogEntries') @Watch('onCatalogRevChanged') catalogEntries: CatalogEntry[] = [];
  @StorageLink('pluginCatalogRevision') @Watch('onCatalogRevChanged') catalogRevision: number = 0;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @Consume('pageStack') pageStack: NavPathStack;
  @State @Watch('onPluginTabChanged') pluginTab: string = 'installed';
  /** 从设置页「语音插件设置」跳转过来时的深链标记 */
  @StorageProp('pluginsDeepLinkVoice') @Watch('onVoiceDeepLink') voiceDeepLink: boolean = false;
  @State showingMore: boolean = false;
  @State hint: string = '';
  @State loading: boolean = false;
  @State pendingName: string = '';
  // 添加插件
  @State addMenuOpen: boolean = false;
  @State addSheetOpen: boolean = false;
  @State addSpec: string = '';
  @State addRegistryMode: string = 'host';
  @State addRegistryUrl: string = '';
  /** 「安装引导和示例」展开态（对齐小程序 guideOpen） */
  @State addGuideOpen: boolean = false;
  // 安装源选择（对齐小程序：弹层列表 + 自定义地址）
  @State registryOptions: RegistryOption[] = [];
  @State registryIndex: number = 0;
  @State registryMenuOpen: boolean = false;
  @State registryLoading: boolean = false;
  @State registryError: string = '';
  // 发现页：索引源管理弹层（对齐小程序 sources dialog）
  @State sourcesOpen: boolean = false;
  @State sourceDraft: string = '';
  @State sourceSaving: boolean = false;
  @State marketMenuOpen: boolean = false;
  // 分类筛选（对齐小程序 market categories）
  @State marketCategories: MarketCategory[] = [];
  @State marketCategory: string = '';
  @State marketCategoriesExpanded: boolean = false;
  // 发现页条目详情弹层
  @State marketDetailOpen: boolean = false;
  @State marketDetailEntry: MarketEntry | undefined = undefined;
  @State addEnableAfter: boolean = true;
  @State addBusy: boolean = false;
  @State addStatus: string = '';
  @State addError: string = '';
  @State addLogs: string = '';
  @State installId: string = '';
  @State detailSaved2: string = '';
  @State webApiEnabled: boolean = false;
  @State webApiBusy: boolean = false;
  @State apiKeyText: string = '';
  @State apiKeyConfigured: boolean = false;
  @State apiKeyWritable: boolean = true;
  @State apiKeyHint: string = '';
  // 插件详情
  @State detailOpen: boolean = false;
  @State detailName: string = '';
  @State detailTitle: string = '';
  @State detailVersion: string = '';
  @State detailDescription: string = '';
  @State detailEnabled: boolean = false;
  @State detailEntries: EntryRow[] = [];
  @State detailBusy: boolean = false;
  @State detailUpdating: boolean = false;
  @State detailError: string = '';
  @State detailUpdateAvailable: boolean = false;
  /** 版本更新状态机：''=未检查 checking latest available updating done error */
  @State detailCheckState: string = '';
  @State detailNewVersion: string = '';
  @State detailUpdateNote: string = '';
  @State detailInstallSpec: string = '';
  @State detailSourceSpec: string = '';
  @State detailTargetVersion: string = '';
  @State detailReadOnlyReason: string = '';
  @State detailExperimental: boolean = false;
  @State detailMarkdown: string = '';
  @State detailKind: string = '';
  @State detailFields: PluginField[] = [];
  @State detailSaving: boolean = false;
  @State detailSaved: string = '';
  // 插件市场
  @State marketLabel: string = '';
  @State marketIndexes: MarketIndex[] = [];
  @State marketSelected: string = '';
  @State marketQuery: string = '';
  @State marketEntries: MarketEntry[] = [];
  @State marketBusy: boolean = false;
  @State marketError: string = '';
  @State marketLoading: boolean = false;
  @State marketSourceInput: string = '';
  @State marketSourceOpen: boolean = false;
  @State marketNext: string = '';

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.60)' : 'rgba(16,19,24,0.60)';
  }

  private accent(): string {
    return '#2E6BE6';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  }

  /** 半模态底部按钮：主按钮（深色玻璃为半透明白，浅色为主题蓝） */
  private sheetPrimaryBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : this.accent();
  }

  private sheetPrimaryBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.24)' : this.accent();
  }

  /** 次按钮：透明底 + 描边 */
  private sheetSecondaryBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  }

  private sheetSecondaryText(): string {
    return this.isDark ? 'rgba(241,244,250,0.72)' : 'rgba(16,19,24,0.62)';
  }

  private iconTint(color: string): number[] {
    const hex: string = color.startsWith('#') ? color.substring(1) : '101318';
    const value: number = parseInt(hex, 16);
    return [0, 0, 0, 0, ((value >> 16) & 255) / 255, 0, 0, 0, 0, ((value >> 8) & 255) / 255, 0, 0, 0, 0, (value & 255) / 255, 0, 0, 0, 1, 0];
  }

  private sheetMaterial(): uiMaterial.Material | undefined {
    try {
      if (!uiMaterial.isImmersiveMaterialSupported()) {
        return undefined;
      }
      return new uiMaterial.ImmersiveMaterial({
        style: uiMaterial.ImmersiveStyle.THICK,
        materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
        colorInvert: true,
        applyShadow: true
      });
    } catch (err) {
      return undefined;
    }
  }

  private shortName(name: string): string {
    const parts: string[] = name.split('/');
    return parts[parts.length - 1];
  }

  private isMoreOnly(item: PluginItem): boolean {
    return MORE_BUNDLES.indexOf(this.shortName(item.name)) >= 0;
  }

  private officialBundles(): PluginItem[] {
    return this.bundles.filter((b: PluginItem) => b.official);
  }

  private featuredBundles(): PluginItem[] {
    return this.officialBundles().filter((b: PluginItem) => !this.isMoreOnly(b) || b.enabled);
  }

  private installedBundles(): PluginItem[] {
    return this.bundles.filter((b: PluginItem) => b.installed && !b.official);
  }

  private readBool(rec: Record<string, Object>, key: string): boolean {
    const value: Object = rec[key];
    return typeof value === 'boolean' ? (value as boolean) : false;
  }

  /** 网关 plugin-detail 返回的文档 markdown（result.markdown），过滤掉无法加载的相对图片 */
  private extractMarkdown(frame: Object): string {
    const rec: Record<string, Object> = this.asRecord(frame);
    const resultObj: Object = rec['result'];
    if (resultObj === undefined) {
      return '';
    }
    const result: Record<string, Object> = this.asRecord(resultObj);
    const raw: string = this.strField(result, 'markdown');
    if (raw.length === 0) {
      return '';
    }
    const lines: string[] = raw.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
      const trimmed: string = line.trim();
      if (trimmed.startsWith('![') && trimmed.indexOf('](') >= 0) {
        continue;
      }
      kept.push(line);
    }
    return kept.join('\n').trim();
  }

  private asRecord(obj: Object): Record<string, Object> {
    try {
      return JSON.parse(JSON.stringify(obj)) as Record<string, Object>;
    } catch (err) {
      return {};
    }
  }

  private strField(rec: Record<string, Object>, key: string): string {
    const value: Object = rec[key];
    if (typeof value === 'string') {
      return value as string;
    }
    return '';
  }

  private arrField(rec: Record<string, Object>, key: string): Object[] {
    const value: Object = rec[key];
    if (Array.isArray(value)) {
      return value as Object[];
    }
    return [];
  }

  /** 网关的 title/description 是本地化对象 {en, zh}，也可能是普通字符串 */
  private localizedField(rec: Record<string, Object>, key: string): string {
    const value: Object = rec[key];
    if (typeof value === 'string') {
      return value as string;
    }
    if (value === undefined || value === null) {
      return '';
    }
    const nested: Record<string, Object> = this.asRecord(value);
    const zh: string = this.strField(nested, 'zh');
    if (zh.length > 0) {
      return zh;
    }
    return this.strField(nested, 'en');
  }

  private frameStatus(frame: Object): string {
    const rec: Record<string, Object> = this.asRecord(frame);
    const message: string = this.strField(rec, 'message');
    if (message.length > 0) {
      return message;
    }
    const phase: string = this.strField(rec, 'phase');
    return phase.length > 0 ? ('安装状态：' + phase) : '';
  }

  @Builder
  pluginArt(name: string) {
    if (name === 'shell') {
      Image($r('app.media.plugin_art_dsh_experimental_terminal_bundle')).width(34.5).height(34.5).objectFit(ImageFit.Contain)
    } else if (name === 'agent-loop') {
      Image($r('app.media.plugin_art_dsh_experimental_ralph_bundle')).width(34.5).height(34.5).objectFit(ImageFit.Contain)
    } else if (name === 'subagent') {
      Image($r('app.media.plugin_art_dsh_subagent_codex')).width(34.5).height(34.5).objectFit(ImageFit.Contain)
    } else if (name === 'web-search') {
      Image($r('app.media.plugin_art_dsh_experimental_session_search')).width(34.5).height(34.5).objectFit(ImageFit.Contain)
    } else if (name === 'dsh-context') {
      Image($r('app.media.plugin_art_dsh_context')).width(34.5).height(34.5).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-ralph-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_ralph_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-terminal-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_terminal_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-session-search') {
      Image($r('app.media.plugin_art_dsh_experimental_session_search')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-session-titles-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_session_titles_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-badge-skill-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_badge_skill_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-plugin-market-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_plugin_market_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-tool-worktree') {
      Image($r('app.media.plugin_art_dsh_experimental_tool_worktree')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-cot-translation-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_cot_translation_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-voice-input-bundle') {
      Image($r('app.media.plugin_art_dsh_experimental_voice_input_bundle')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-agent-team-profile') {
      Image($r('app.media.plugin_art_dsh_experimental_agent_team_profile')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-auto-review') {
      Image($r('app.media.plugin_art_dsh_experimental_auto_review')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-inspector-profile') {
      Image($r('app.media.plugin_art_dsh_experimental_inspector_profile')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-experimental-inspector') {
      Image($r('app.media.plugin_art_dsh_experimental_inspector')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-subagent-codex') {
      Image($r('app.media.plugin_art_dsh_subagent_codex')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-subagent-claude-code') {
      Image($r('app.media.plugin_art_dsh_subagent_claude_code')).width(34).height(34).objectFit(ImageFit.Contain)
    } else if (this.shortName(name) === 'dsh-context') {
      Image($r('app.media.plugin_art_dsh_context')).width(34).height(34).objectFit(ImageFit.Contain)
    } else {
      Image($r('app.media.plugin_art_plugin_default')).width(34).height(34).objectFit(ImageFit.Contain)
    }
  }

  @Builder
  badge(text: string, fg: string, bg: string) {
    Text(text)
      .fontSize(10)
      .fontColor(fg)
      .padding({ left: 6, right: 6, top: 1, bottom: 1 })
      .borderRadius(5)
      .backgroundColor(bg)
  }

  @Builder
  bundleRow(item: PluginItem, last: boolean) {
    Row({ space: 11 }) {
      Row() {
        this.pluginArt(item.name)
      }
      .width(46)
      .height(46)
      .borderRadius(12)
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)' })
      .justifyContent(FlexAlign.Center)
      Column({ space: 4.5 }) {
        Row({ space: 5 }) {
          Text(item.title)
            .fontSize(13.5)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.experimental) {
            this.badge('实验性', this.isDark ? '#C8B2FF' : '#5B4DB8', this.isDark ? 'rgba(140,110,255,0.20)' : 'rgba(120,95,240,0.10)')
          }
          if (item.error.length > 0) {
            this.badge('异常', this.isDark ? '#FF5A52' : '#C7362D', this.isDark ? 'rgba(255,69,58,0.16)' : 'rgba(214,45,36,0.10)')
          }
          if (item.updateAvailable) {
            this.badge('可更新', this.isDark ? '#7E9AF2' : '#3D5BB8', this.isDark ? 'rgba(90,120,220,0.18)' : 'rgba(64,90,190,0.10)')
          }
        }
        .width('100%')
        if (item.description.length > 0) {
          Text(item.description)
            .fontSize(11.5)
            .fontColor(this.subColor())
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        if (item.availability.length > 0 && item.availability !== 'available') {
          Text('开启时安装').fontSize(11).fontColor(this.isDark ? '#7E9AF2' : '#3D5BB8')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      if (this.pendingName === item.name) {
        LoadingProgress().width(22).height(22).color(this.subColor())
      } else {
        Toggle({ type: ToggleType.Switch, isOn: item.enabled })
          .selectedColor(this.accent())
          .scale({ x: 0.72, y: 0.72 })
          .onChange((isOn: boolean) => {
            this.onToggle(item, isOn);
          })
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 60 })
    .padding({ top: 5, bottom: 5 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.openDetail(item);
    })
  }

  @Builder
  officialRow(item: OfficialPluginItem, last: boolean) {
    Row({ space: 11 }) {
      Row() {
        this.pluginArt(item.id)
      }
      .width(46)
      .height(46)
      .borderRadius(12)
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)' })
      .justifyContent(FlexAlign.Center)
      Column({ space: 4.5 }) {
        Text(item.title)
          .fontSize(13.5)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        if (item.description.length > 0) {
          Text(item.description)
            .fontSize(11.5)
            .fontColor(this.subColor())
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .constraintSize({ minHeight: 60 })
    .padding({ top: 5, bottom: 5 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.openOfficialDetail(item);
    })
  }

  @Builder
  sectionTitle(title: string, count: string, more: boolean) {
    Row({ space: 7 }) {
      Text(title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.textColor())
      if (count.length > 0) {
        Text(count).fontSize(11).fontColor(this.subColor())
      }
      Row().layoutWeight(1)
      if (more) {
        Text('更多 ›')
          .fontSize(13)
          .fontColor(this.subColor())
          .onClick(() => {
            this.showingMore = true;
          })
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 24 })
    .padding({ top: 4, bottom: 4 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  addEntry() {
    Row() {
      Row() {
        Text('＋ 添加插件').fontSize(12).fontColor(this.accent())
      }
      .height(30)
      .padding({ left: 12, right: 10 })
      .onClick(() => {
        this.addSheetOpen = true;
        this.addError = '';
        this.addStatus = '';
        this.loadRegistryOptions();
      })
      // 「添加插件」文字与右侧箭头之间的竖向分隔线（对齐 dsh 桌面端的拆分按钮）
      Column()
        .width(1)
        .height(14)
        .backgroundColor(this.isDark ? 'rgba(143,180,242,0.35)' : 'rgba(46,107,230,0.28)')
      Row() {
        // 展开菜单，箭头朝下（资源默认朝右）
        Image($r('app.media.ic_dir_chevron_mist'))
          .width(10)
          .height(10)
          .rotate({ angle: 90 })
          .colorFilter(this.iconTint(this.accent()))
      }
      .width(28)
      .height(30)
      .justifyContent(FlexAlign.Center)
      .onClick(() => {
        this.addMenuOpen = !this.addMenuOpen;
      })
    }
    .borderRadius(8)
    .backgroundColor(this.isDark ? 'rgba(46,107,230,0.18)' : 'rgba(46,107,230,0.10)')
  }

  @Builder
  addMenuBuilder() {
    Column() {
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          Text('安装第三方插件').fontSize(15).fontColor(this.textColor())
          Text('支持 npm 包、Git 仓库和主机目录').fontSize(11).fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .onClick(() => {
        this.addMenuOpen = false;
        this.addSheetOpen = true;
        this.addError = '';
        this.addStatus = '';
        this.loadRegistryOptions();
      })
      Row() {
        Column({ space: 2 }) {
          Text('让 Agent 创建插件').fontSize(15).fontColor(this.textColor())
          Text('新建一个会话，让 Agent 帮你写插件').fontSize(11).fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .onClick(() => {
        this.addMenuOpen = false;
        this.hint = '请在会话里让 Agent 创建插件后，用「安装第三方插件」安装主机目录';
      })
    }
    .width(240)
    .padding({ top: 4, bottom: 4 })
  }

  @Builder
  addSheetContent() {
    Column() {
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)

      Row() {
        Text('添加插件').fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.textColor())
        Blank()
        Text('×')
          .fontSize(20)
          .fontColor(this.subColor())
          .width(36)
          .height(36)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.addSheetOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 12, bottom: 6 })

      Text('输入 npm 包名、Git 仓库地址或 DSH 主机上的插件目录路径。')
        .fontSize(12)
        .fontColor(this.subColor())
        .width('100%')
        .padding({ left: 18, right: 18, bottom: 14 })

      TextInput({ text: this.addSpec, placeholder: '例如 dsh-plugin-whale-pet' })
        .fontSize(14)
        .fontColor(this.textColor())
        .placeholderColor(this.subColor())
        .backgroundColor('rgba(0,0,0,0)')
        .borderRadius(8)
        .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' })
        .height(44)
        .margin({ left: 18, right: 18 })
        .onChange((value: string) => {
          this.addSpec = value;
        })

      // 安装引导开关 + 安装源（对齐小程序 plugin-install-options）
      Row({ space: 10 }) {
        Row({ space: 4 }) {
          Text(this.addGuideOpen ? '收起引导' : '安装引导和示例')
            .fontSize(13)
            .fontColor(this.accent())
          Image($r('app.media.ic_dir_chevron_mist'))
            .width(9)
            .height(9)
            .rotate({ angle: this.addGuideOpen ? 225 : 45 })
            .colorFilter(this.iconTint(this.accent()))
        }
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.addGuideOpen = !this.addGuideOpen;
        })
        Blank()
        Row({ space: 6 }) {
          Text('安装源').fontSize(12).fontColor(this.subColor())
          Text(this.currentRegistryLabel())
            .fontSize(12)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 150 })
          Image($r('app.media.ic_dir_chevron_mist'))
            .width(9)
            .height(9)
            .rotate({ angle: this.registryMenuOpen ? 225 : 45 })
            .colorFilter(this.iconTint(this.subColor()))
        }
        .padding({ left: 10, right: 10, top: 6, bottom: 6 })
        .borderRadius(8)
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' })
        .onClick(() => {
          this.registryMenuOpen = !this.registryMenuOpen;
        })
        // 弹层选择安装源（对齐小程序 registry 选择弹层）
        .bindMenu(this.registryMenuOpen, this.registryMenuBuilder(), {
          placement: Placement.BottomRight,
          onDisappear: () => {
            this.registryMenuOpen = false;
          }
        })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 12 })
      .alignItems(VerticalAlign.Center)

      if (this.addGuideOpen) {
        Text('包名：dsh-plugin-whale-pet 或 @作者/插件名\nGit：填写实际仓库地址\n目录：填写电脑上的绝对路径，不是手机路径\n私有安装源凭据请配置在 DSH 主机的 .npmrc 中')
          .fontSize(11)
          .lineHeight(17)
          .fontColor(this.subColor())
          .width('calc(100% - 36vp)')
          .margin({ left: 18, right: 18 })
          .padding(12)
          .borderRadius(10)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
      }

      if (this.currentRegistryValue() === 'custom') {
        TextInput({ text: this.addRegistryUrl, placeholder: 'https://npm.example.com/' })
          .fontSize(14)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
          .borderRadius(10)
          .height(42)
          .margin({ left: 18, right: 18, top: 8 })
          .onChange((value: string) => {
            this.addRegistryUrl = value;
          })
      }

      Row() {
        Text('安装后立即启用').fontSize(14).fontColor(this.textColor())
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.addEnableAfter })
          .selectedColor(this.accent())
          .onChange((isOn: boolean) => {
            this.addEnableAfter = isOn;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 10 })

      Text('请确认插件来源可信。插件将在所连接的 DSH 主机以你的权限运行，可能读取、修改或泄露数据。安装操作不会在手机上执行。')
        .fontSize(11)
        .lineHeight(17)
        .fontColor(this.isDark ? '#FFB05C' : '#B26A00')
        .width('calc(100% - 36vp)')
        .margin({ left: 18, right: 18, top: 2 })
        .padding(12)
        .borderRadius(10)
        .backgroundColor(this.isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.10)')

      if (this.addError.length > 0) {
        Text(this.addError)
          .fontSize(12)
          .fontColor('#FF3B30')
          .width('100%')
          .padding({ left: 18, right: 18, top: 8 })
      }
      if (this.addStatus.length > 0) {
        Row({ space: 8 }) {
          if (this.addBusy) {
            LoadingProgress().width(16).height(16).color(this.subColor())
          }
          Text(this.addStatus).fontSize(12).fontColor(this.subColor())
        }
        .width('100%')
        .padding({ left: 18, right: 18, top: 10 })
      }

      if (this.addLogs.length > 0) {
        Scroll() {
          Text(this.addLogs)
            .fontSize(11)
            .fontColor(this.subColor())
            .width('100%')
        }
        .height(120)
        .width('calc(100% - 36vp)')
        .margin({ left: 18, right: 18, top: 8 })
        .padding(10)
        .borderRadius(10)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .scrollBar(BarState.Off)
      }

      Blank()

      Row({ space: 10 }) {
        if (this.addBusy) {
          Text('取消安装')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.sheetSecondaryText())
            .layoutWeight(1)
            .height(42)
            .textAlign(TextAlign.Center)
            .borderRadius(9)
            .border({ width: 0.5, color: this.sheetSecondaryBorder() })
            .backgroundColor('rgba(0,0,0,0)')
            .onClick(() => {
              this.cancelInstallRun();
            })
          Text('核对状态')
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .layoutWeight(1)
            .height(42)
            .textAlign(TextAlign.Center)
            .borderRadius(9)
            .border({ width: 0.5, color: this.sheetPrimaryBorder() })
            .backgroundColor(this.sheetPrimaryBg())
            .onClick(() => {
              this.reconcileInstallRun();
            })
        } else {
          Text('安装')
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .layoutWeight(1)
            .height(42)
            .textAlign(TextAlign.Center)
            .borderRadius(9)
            .border({ width: 0.5, color: this.sheetPrimaryBorder() })
            .backgroundColor(this.sheetPrimaryBg())
            .onClick(() => {
              this.runInstall();
            })
        }
      }
      .width('100%')
      .padding({ left: 18, right: 18, bottom: 16, top: 12 })
    }
    .width('100%')
    .height('100%')
  }

  aboutToAppear(): void {
    // 页面创建时 deep link 可能已经是 true（@Watch 不会为初始值触发）
    this.consumeVoiceDeepLink();
  }

  onVoiceDeepLink(): void {
    this.consumeVoiceDeepLink();
  }

  /** 从设置页「语音插件设置」进来：自动打开语音插件的详情（即该插件的语音设置） */
  private consumeVoiceDeepLink(): void {
    if (!this.voiceDeepLink) {
      return;
    }
    AppStorage.setOrCreate<boolean>('pluginsDeepLinkVoice', false);
    this.openVoicePluginDetail(0);
  }

  private openVoicePluginDetail(tick: number): void {
    for (const item of this.bundles) {
      const name: string = item.name.toLowerCase();
      if (name.indexOf('voice') >= 0) {
        this.openDetail(item);
        return;
      }
    }
    // 插件列表可能还没拉到：短暂重试几次
    if (tick < 12) {
      setTimeout(() => {
        this.openVoicePluginDetail(tick + 1);
      }, 300);
    }
  }

  @Builder
  detailSheetContent() {
    Column() {
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)

      Row({ space: 12 }) {
        this.pluginArt(this.detailName)
        Column({ space: 3 }) {
          Text(this.detailTitle.length > 0 ? this.detailTitle : this.detailName)
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 6 }) {
            if (this.detailVersion.length > 0) {
              Text('v' + this.detailVersion).fontSize(12).fontColor(this.subColor())
            }
            if (this.detailExperimental) {
              Text('实验性')
                .fontSize(10)
                .fontColor(this.isDark ? '#7E9AF2' : '#3D5BB8')
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(6)
                .backgroundColor(this.isDark ? 'rgba(90,120,220,0.18)' : 'rgba(64,90,190,0.10)')
            }
          }
          .alignItems(VerticalAlign.Center)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text('×')
          .fontSize(20)
          .fontColor(this.subColor())
          .width(36)
          .height(36)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.detailOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 12, bottom: 10 })

      Scroll() {
        Column({ space: 14 }) {
          if (this.detailDescription.length > 0) {
            Text(this.detailDescription)
              .fontSize(13)
              .lineHeight(20)
              .fontColor(this.subColor())
              .width('100%')
          }

          // 版本更新卡（对齐 dsh 端详情：检查更新 / 已是最新 / 可更新到 x / 更新）
          if (this.detailKind === '') {
            Column({ space: 8 }) {
              Row() {
                Column({ space: 2 }) {
                  Text('版本更新').fontSize(14).fontColor(this.textColor())
                  Text(this.updateStateText())
                    .fontSize(11)
                    .fontColor(this.detailCheckState === 'error' ? '#FF3B30' : this.subColor())
                  if (this.detailTargetVersion.length > 0) {
                    Text('目标版本 v' + this.detailTargetVersion)
                      .fontSize(11)
                      .fontColor(this.subColor())
                  }
                  if (this.detailReadOnlyReason.length > 0) {
                    Text(this.detailReadOnlyReason)
                      .fontSize(11)
                      .fontColor(this.subColor())
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                if (this.detailUpdating || this.detailCheckState === 'checking') {
                  LoadingProgress().width(18).height(18).color(this.subColor())
                } else if (this.detailCheckState === 'available' || this.detailUpdateAvailable) {
                  Text('更新')
                    .fontSize(13)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.accent())
                    .onClick(() => {
                      this.runDetailUpdate();
                    })
                } else {
                  Text('检查更新')
                    .fontSize(13)
                    .fontColor(this.accent())
                    .onClick(() => {
                      this.checkDetailUpdate();
                    })
                }
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
            }
            .width('100%')
            .padding(12)
            .borderRadius(12)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)')
          }

          // 安装来源（对齐 dsh 端「当前 DSH 对应来源」）
          if (this.detailInstallSpec.length > 0 || this.detailSourceSpec.length > 0) {
            Row({ space: 8 }) {
              Text('安装来源').fontSize(13).fontColor(this.subColor())
              Text(this.detailInstallSpec.length > 0 ? this.detailInstallSpec : this.detailSourceSpec)
                .fontSize(12)
                .fontColor(this.textColor())
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .textAlign(TextAlign.End)
            }
            .width('100%')
            .padding({ left: 12, right: 12, top: 8, bottom: 8 })
            .borderRadius(12)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)')
          }

          if (this.detailKind === 'web-search') {
            Column({ space: 10 }) {
              Row() {
                Column({ space: 2 }) {
                  Text('使用 DeepSeek 搜索 API').fontSize(14).fontColor(this.textColor())
                  Text('开启后通过 DeepSeek 搜索接口检索，否则使用内置搜索。')
                    .fontSize(11)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                if (this.webApiBusy) {
                  LoadingProgress().width(18).height(18).color(this.subColor())
                } else {
                  Toggle({ type: ToggleType.Switch, isOn: this.webApiEnabled })
                    .selectedColor(this.accent())
                    .scale({ x: 0.72, y: 0.72 })
                    .onChange((isOn: boolean) => {
                      this.toggleWebApi(isOn);
                    })
                }
              }
              .width('100%')

              Column({ space: 5 }) {
                Text('API Key').fontSize(13).fontColor(this.subColor())
                TextInput({ text: this.apiKeyText, placeholder: this.apiKeyConfigured ? '已配置，输入新值可覆盖' : '未配置' })
                  .type(InputType.Password)
                  .fontSize(14)
                  .fontColor(this.textColor())
                  .placeholderColor(this.subColor())
                  .height(42)
                  .borderRadius(10)
                  .enabled(this.apiKeyWritable)
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                  .onChange((value: string) => {
                    this.apiKeyText = value;
                  })
                Row({ space: 10 }) {
                  Text(this.apiKeyHint).fontSize(11).fontColor(this.subColor()).layoutWeight(1)
                  Text('保存凭据')
                    .fontSize(12)
                    .fontColor(this.accent())
                    .onClick(() => {
                      this.saveApiKey();
                    })
                }
                .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
            }
            .width('100%')
          }

          if (this.detailMarkdown.length > 0) {
            MarkdownBodyView({
              text: this.detailMarkdown,
              fontSize: 13,
              textColor: ''
            })
              .width('100%')
          }

          if (this.detailFields.length > 0) {
            Column({ space: 12 }) {
              ForEach(this.detailFields, (field: PluginField, index: number) => {
                Column({ space: 5 }) {
                  Row() {
                    Text(field.label).fontSize(13).fontColor(this.subColor()).layoutWeight(1)
                    Text('恢复默认')
                      .fontSize(11)
                      .fontColor(this.accent())
                      .onClick(() => {
                        this.resetField(field);
                      })
                  }
                  .width('100%')
                  TextInput({ text: field.value, placeholder: '留空使用默认值' })
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .placeholderColor(this.subColor())
                    .type(InputType.Number)
                    .height(42)
                    .borderRadius(10)
                    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                    .onChange((value: string) => {
                      this.setFieldValue(index, value);
                    })
                  if (field.hint.length > 0) {
                    Text(field.hint).fontSize(11).fontColor(this.subColor())
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .width('100%')
              }, (field: PluginField) => field.ns + ':' + field.key)
              if (this.detailSaved.length > 0) {
                Text(this.detailSaved).fontSize(12).fontColor(this.accent())
              }
            }
            .width('100%')
          }

          if (!this.detailBusy && this.detailDescription.length === 0 && this.detailError.length === 0) {
            Text('未获取到插件详情').fontSize(12).fontColor(this.subColor()).width('100%')
          }

          if (this.detailKind.length === 0) {
          Row() {
            Text('启用插件').fontSize(15).fontColor(this.textColor())
            Blank()
            if (this.detailBusy) {
              LoadingProgress().width(18).height(18).color(this.subColor())
            } else {
              Toggle({ type: ToggleType.Switch, isOn: this.detailEnabled })
                .selectedColor(this.accent())
                .onChange((isOn: boolean) => {
                  this.setDetailEnabled(isOn);
                })
            }
          }
          .width('100%')
          .padding({ top: 2, bottom: 2 })
          }

          if (this.detailEntries.length > 0) {
            Column({ space: 6 }) {
              Row({ space: 8 }) {
                Text('包含的组件')
                  .fontSize(14)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                Text('共 ' + this.detailEntries.length + ' 个 · ' + this.runningEntryCount() + ' 运行中')
                  .fontSize(11)
                  .fontColor(this.subColor())
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
              ForEach(this.detailEntries, (entry: EntryRow) => {
                Row() {
                  Column({ space: 2 }) {
                    Text(entry.name).fontSize(14).fontColor(this.textColor())
                    if (entry.description.length > 0) {
                      Text(entry.description)
                        .fontSize(11)
                        .fontColor(this.subColor())
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                    if (entry.moduleLine.length > 0) {
                      Text(entry.moduleLine)
                        .fontSize(10)
                        .fontColor(this.subColor())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                    if (entry.packageName.length > 0) {
                      Text(entry.packageName)
                        .fontSize(10)
                        .fontColor(this.subColor())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Row({ space: 5 }) {
                    if (this.entryRunning(entry)) {
                      Circle().width(6).height(6).fill('#34C759')
                      Text('运行中').fontSize(11).fontColor(this.subColor())
                    } else if (entry.enabled) {
                      Circle().width(6).height(6).fill(this.subColor())
                      Text(this.entryStatusText(entry)).fontSize(11).fontColor(this.subColor())
                    }
                    Toggle({ type: ToggleType.Switch, isOn: entry.enabled })
                      .selectedColor(this.accent())
                      .scale({ x: 0.65, y: 0.65 })
                      .onChange((isOn: boolean) => {
                        this.toggleEntry(entry, isOn);
                      })
                  }
                  .alignItems(VerticalAlign.Center)
                }
                .width('100%')
                .padding({ left: 12, right: 8, top: 5, bottom: 5 })
                .borderRadius(10)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
              }, (entry: EntryRow) => entry.id + '_' + entry.enabled.toString())
            }
            .width('100%')
          }

          Column({ space: 8 }) {
            Text('来源信息').fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.subColor())
            Row() {
              Text('当前版本').fontSize(13).fontColor(this.subColor()).layoutWeight(1)
              Text(this.detailVersion.length > 0 ? ('v' + this.detailVersion) : '未知')
                .fontSize(13)
                .fontColor(this.textColor())
            }
            .width('100%')
            Row() {
              Text('包名').fontSize(13).fontColor(this.subColor()).layoutWeight(1)
              Text(this.detailName).fontSize(12).fontColor(this.textColor()).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: 220 })
            }
            .width('100%')
            if (this.detailUpdateAvailable) {
              Row() {
                Text('状态').fontSize(13).fontColor(this.subColor()).layoutWeight(1)
                Text('有新版本可更新').fontSize(12).fontColor(this.accent())
              }
              .width('100%')
            }
          }
          .width('100%')

          if (this.detailError.length > 0) {
            Text(this.detailError).fontSize(12).fontColor('#FF3B30').width('100%')
          }

          if (this.detailBusy && this.detailEntries.length === 0 && this.detailDescription.length === 0) {
            Row({ space: 8 }) {
              LoadingProgress().width(16).height(16).color(this.subColor())
              Text('正在读取插件详情…').fontSize(12).fontColor(this.subColor())
            }
            .width('100%')
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .constraintSize({ minHeight: '100%' })
        .justifyContent(FlexAlign.Start)
        .padding({ left: 18, right: 18, bottom: 16 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)

      Row({ space: 10 }) {
        if (this.detailKind.length > 0) {
          Text(this.detailSaving ? '保存中…' : '保存')
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .layoutWeight(1)
            .height(42)
            .textAlign(TextAlign.Center)
            .borderRadius(9)
            .border({ width: 0.5, color: this.sheetPrimaryBorder() })
            .backgroundColor(this.sheetPrimaryBg())
            .opacity(this.detailSaving ? 0.6 : 1)
            .onClick(() => {
              this.saveOfficialSettings();
            })
        } else {
          Text('卸载')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FF3B30')
            .layoutWeight(1)
            .height(42)
            .textAlign(TextAlign.Center)
            .borderRadius(9)
            .border({ width: 0.5, color: 'rgba(255,59,48,0.35)' })
            .backgroundColor('rgba(0,0,0,0)')
            .onClick(() => {
              this.uninstallDetail();
            })
        }
        Text('关闭')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.sheetSecondaryText())
          .layoutWeight(1)
          .height(42)
          .textAlign(TextAlign.Center)
          .borderRadius(9)
          .border({ width: 0.5, color: this.sheetSecondaryBorder() })
          .backgroundColor('rgba(0,0,0,0)')
          .onClick(() => {
            this.detailOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, bottom: 16 })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  marketEntryRow(item: MarketEntry, last: boolean) {
    Column() {
      Row({ space: 12 }) {
        // 图标底板：与「已安装」列表同一款式；有图标地址时显示插件真实图标（失败回退默认图形）
        Stack({ alignContent: Alignment.Center }) {
          Image($r('app.media.plugin_art_plugin_default')).width(30).height(30).objectFit(ImageFit.Contain)
          if (item.iconUrl.length > 0 && !item.iconFailed) {
            Image(item.iconUrl)
              .width(44)
              .height(44)
              .objectFit(ImageFit.Cover)
              .borderRadius(11)
              .onError(() => {
                const failed: MarketEntry = {
                  name: item.name, title: item.title, description: item.description,
                  version: item.version, installLabel: item.installLabel,
                  iconUrl: item.iconUrl, iconFailed: true,
                  homepage: item.homepage, repository: item.repository,
                  packageSpec: item.packageSpec, publishDate: item.publishDate,
                  categoryId: item.categoryId, installed: item.installed
                };
                this.patchMarketEntry(failed);
              })
          }
        }
        .width(44)
        .height(44)
        .borderRadius(11)
        .clip(true)
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' })
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)')

        Column({ space: 3 }) {
          Text(item.title.length > 0 ? item.title : item.name)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.description.length > 0) {
            Text(item.description)
              .fontSize(12)
              .fontColor(this.subColor())
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
          }
          if (item.version.length > 0) {
            Text(item.version)
              .fontSize(11)
              .fontColor(this.subColor())
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (item.installLabel.length > 0) {
          Text(item.installLabel)
            .fontSize(12)
            .fontColor(this.subColor())
            .padding({ left: 6, right: 2 })
        } else {
          Text('安装')
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.accent())
            .height(30)
            .padding({ left: 14, right: 14 })
            .textAlign(TextAlign.Center)
            .borderRadius(8)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' })
            .onClick(() => {
              this.installMarketEntry(item);
            })
        }
      }
      .width('100%')
      // 外层容器已有 16 的左右内边距，这里不再叠加（否则行比上方搜索/分类条窄一截）
      .padding({ left: 0, right: 0, top: 11, bottom: 11 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.marketDetailEntry = item;
        this.marketDetailOpen = true;
      })
      if (!last) {
        Row().width('100%').height(0.5).backgroundColor(this.dividerColor()).margin({ left: 56 })
      }
    }
    .width('100%')
  }

  /** 发现页条目详情底部弹层：完整描述 + 包名 + 版本 + 安装 */
  @Builder
  marketDetailSheet() {
    Column() {
      Column()
        .width(36)
        .height(4)
        .borderRadius(2)
        .margin({ top: 8, bottom: 8 })
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)')
      Row({ space: 12 }) {
        Stack({ alignContent: Alignment.Center }) {
          Image($r('app.media.plugin_art_plugin_default')).width(30).height(30).objectFit(ImageFit.Contain)
        }
        .width(44)
        .height(44)
        .borderRadius(11)
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' })
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)')
        Column({ space: 2 }) {
          Text(this.marketDetailTitle())
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.marketDetailVersion().length > 0) {
            Text('版本 ' + this.marketDetailVersion()).fontSize(11).fontColor(this.subColor())
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text('×')
          .fontSize(20)
          .fontColor(this.subColor())
          .width(36)
          .height(36)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.marketDetailOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 10, bottom: 10 })
      .alignItems(VerticalAlign.Top)

      Scroll() {
        Column({ space: 10 }) {
          Text(this.marketDetailDescription())
            .fontSize(13)
            .lineHeight(20)
            .fontColor(this.textColor())
            .width('100%')

          // 版本（对齐 dsh 端：版本号 + 当前已安装 + 发布日期）
          Text('版本')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .width('100%')
            .margin({ top: 6 })
          Row({ space: 8 }) {
            Text(this.marketDetailVersion().length > 0 ? this.marketDetailVersion() : '未知')
              .fontSize(14)
              .fontColor(this.textColor())
          }
          .width('100%')
          if (this.marketDetailInstalled()) {
            Text('当前已安装')
              .fontSize(11)
              .fontColor(this.isDark ? '#5BD6A2' : '#1F9D55')
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .borderRadius(6)
              .backgroundColor(this.isDark ? 'rgba(31,157,85,0.16)' : 'rgba(31,157,85,0.10)')
          }
          Text(this.marketDetailPublishDate().length > 0 ? this.marketDetailPublishDate() : '')
            .fontSize(11)
            .fontColor(this.subColor())
            .width('100%')

          // 来源
          Text('来源')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .width('100%')
            .margin({ top: 10 })
          if (this.marketDetailHomepage().length > 0) {
            this.detailSourceRow('主页', this.marketDetailHomepage(), true)
          }
          if (this.marketDetailRepository().length > 0) {
            this.detailSourceRow('源代码', this.marketDetailRepository(), true)
          }
          if (this.marketDetailPackageSpec().length > 0) {
            this.detailSourceRow('软件包', this.marketDetailPackageSpec(), false)
          }
          if (this.marketDetailPublishDate().length > 0) {
            this.detailSourceRow('发布时间', this.marketDetailPublishDate(), false)
          }
          if (this.marketDetailCategory().length > 0) {
            this.detailSourceRow('分类', this.marketDetailCategory(), false)
          }
          this.detailSourceRow('插件索引', this.marketLabel.length > 0 ? this.marketLabel : this.marketSelected, false)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 18, right: 18 })
      .scrollBar(BarState.Off)
      .align(Alignment.Top)

      Text('安装')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.accent())
        .height(44)
        .width('calc(100% - 36vp)')
        .margin({ left: 18, right: 18, top: 10, bottom: 16 })
        .textAlign(TextAlign.Center)
        .borderRadius(10)
        .backgroundColor('rgba(0,0,0,0)')
        .border({ width: 0.8, color: this.accent() })
        .onClick(() => {
          const entry: MarketEntry | undefined = this.marketDetailEntry;
          this.marketDetailOpen = false;
          if (entry !== undefined) {
            this.installMarketEntry(entry);
          }
        })
    }
    .width('100%')
    .height('100%')
  }

  private marketDetailTitle(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    if (entry === undefined) {
      return '';
    }
    return entry.title.length > 0 ? entry.title : entry.name;
  }

  private marketDetailName(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry === undefined ? '' : entry.name;
  }

  private marketDetailVersion(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry === undefined ? '' : entry.version;
  }

  /** 详情「来源」区的一行：左标签、右值（链接蓝色） */
  @Builder
  detailSourceRow(label: string, value: string, link: boolean) {
    Row() {
      Text(label).fontSize(12).fontColor(this.subColor())
      Blank()
      Text(value)
        .fontSize(12)
        .fontColor(link ? this.accent() : this.textColor())
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.End)
        .constraintSize({ maxWidth: '70%' })
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    .padding({ top: 8, bottom: 8 })
    .alignItems(VerticalAlign.Center)
    .border({ width: { bottom: 0.5 }, color: this.dividerColor() })
  }

  private marketDetailHomepage(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry === undefined ? '' : entry.homepage;
  }

  private marketDetailRepository(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry === undefined ? '' : entry.repository;
  }

  private marketDetailPackageSpec(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry === undefined ? '' : entry.packageSpec;
  }

  private marketDetailPublishDate(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry === undefined ? '' : entry.publishDate;
  }

  private marketDetailCategory(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    if (entry === undefined || entry.categoryId.length === 0) {
      return '';
    }
    for (const cat of this.marketCategories) {
      if (cat.id === entry.categoryId) {
        return cat.title;
      }
    }
    return entry.categoryId;
  }

  private marketDetailInstalled(): boolean {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    return entry !== undefined && entry.installed;
  }

  private marketDetailDescription(): string {
    const entry: MarketEntry | undefined = this.marketDetailEntry;
    if (entry === undefined) {
      return '';
    }
    return entry.description.length > 0 ? entry.description : '该插件没有提供描述。';
  }

  @Builder
  marketBody() {
    Column() {
      if (this.sourcesOpen) {
        this.sourcesPanel()
      }
      if (this.connection !== 'connected') {
        Column({ space: 8 }) {
          Image($r('app.media.plugin_art_plugin_default')).width(44).height(44).objectFit(ImageFit.Contain)
          Text('网关未连接').fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.textColor())
          Text('连接网关后可以浏览插件市场并安装插件。')
            .fontSize(12)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding({ top: 48, bottom: 48, left: 24, right: 24 })
      } else if (this.marketLoading && this.marketEntries.length === 0) {
        Column({ space: 8 }) {
          LoadingProgress().width(24).height(24).color(this.subColor())
          Text('正在读取索引源…').fontSize(12).fontColor(this.subColor())
        }
        .width('100%')
        .padding({ top: 48, bottom: 48 })
      } else if (this.marketError.length > 0) {
        Column({ space: 8 }) {
          Image($r('app.media.plugin_art_plugin_default')).width(44).height(44).objectFit(ImageFit.Contain)
          Text('无法读取索引源').fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.textColor())
          Text(this.marketError).fontSize(12).fontColor(this.subColor()).textAlign(TextAlign.Center)
          Text('重试')
            .fontSize(13)
            .fontColor(this.accent())
            .padding({ top: 6 })
            .onClick(() => {
              this.loadMarketIndexes();
            })
        }
        .width('100%')
        .padding({ top: 40, bottom: 40, left: 24, right: 24 })
      } else if (this.marketIndexes.length === 0) {
        Column({ space: 10 }) {
          Image($r('app.media.plugin_art_plugin_default')).width(44).height(44).objectFit(ImageFit.Contain)
          Text('还没有插件市场').fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.textColor())
          Text('添加一个插件市场索引，即可在这里浏览和安装其中的插件')
            .fontSize(12)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
          Text('＋ 添加索引源')
            .fontSize(13)
            .fontColor(this.accent())
            .height(38)
            .padding({ left: 14, right: 14 })
            .textAlign(TextAlign.Center)
            .borderRadius(8)
            .backgroundColor(this.isDark ? 'rgba(46,107,230,0.18)' : 'rgba(46,107,230,0.10)')
            .onClick(() => {
              this.sourcesOpen = true;
            })
        }
        .width('100%')
        .padding({ top: 40, bottom: 40 })
      } else {
        // 索引源选择 + 搜索
        Row({ space: 10 }) {
          Row({ space: 6 }) {
            Text(this.marketSelected.length > 0 ? this.marketLabel : '插件市场')
              .fontSize(13)
              .fontColor(this.textColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: 150 })
            Image($r('app.media.ic_dir_chevron_mist'))
              .width(10)
              .height(10)
              .colorFilter(this.iconTint(this.subColor()))
          }
          .height(34)
          .padding({ left: 10, right: 10 })
          .borderRadius(8)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
          .onClick(() => {
            this.marketMenuOpen = !this.marketMenuOpen;
          })
          // 切换市场 + 管理索引源（对齐小程序 market picker menu）
          .bindMenu(this.marketMenuOpen, this.marketMenuBuilder(), {
            placement: Placement.BottomLeft,
            onDisappear: () => {
              this.marketMenuOpen = false;
            }
          })
          TextInput({ text: this.marketQuery, placeholder: '搜索插件' })
            .fontSize(13)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
            .borderRadius(8)
            .height(34)
            .layoutWeight(1)
            .onChange((value: string) => {
              this.marketQuery = value;
            })
            .onSubmit(() => {
              this.loadMarketEntries('');
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 8, bottom: 8 })

        // 分类筛选条（对齐小程序：分类 + 数量 + 展开全部 + chips）
        if (this.marketCategories.length > 0) {
          Column({ space: 8 }) {
            Row() {
              Text('分类').fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.textColor())
              Text(this.marketCategories.length.toString())
                .fontSize(11)
                .fontColor(this.subColor())
                .padding({ left: 4 })
              Blank()
              if (this.marketCategories.length > 7) {
                Text(this.marketCategoriesExpanded ? '收起' : '展开全部')
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .onClick(() => {
                    this.marketCategoriesExpanded = !this.marketCategoriesExpanded;
                  })
              }
            }
            .width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              Text('全部')
                .fontSize(12)
                .fontColor(this.marketCategory.length === 0 ? this.accent() : this.subColor())
                .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                .borderRadius(7)
                .margin({ right: 6, bottom: 6 })
                .backgroundColor(this.marketCategory.length === 0
                  ? (this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.12)')
                  : (this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'))
                .onClick(() => {
                  this.marketCategory = '';
                  this.loadMarketEntries('');
                })
              ForEach(this.marketCategories, (cat: MarketCategory, index: number) => {
                if (this.marketCategoriesExpanded || index < 7 || this.marketCategory === cat.id) {
                  Text(cat.title)
                    .fontSize(12)
                    .fontColor(this.marketCategory === cat.id ? this.accent() : this.subColor())
                    .maxLines(1)
                    .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                    .borderRadius(7)
                    .margin({ right: 6, bottom: 6 })
                    .backgroundColor(this.marketCategory === cat.id
                      ? (this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.12)')
                      : (this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'))
                    .onClick(() => {
                      this.marketCategory = cat.id;
                      this.loadMarketEntries('');
                    })
                }
              }, (cat: MarketCategory) => cat.id)
            }
            .width('100%')
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 8, bottom: 8 })
        }

        if (this.marketEntries.length > 0) {
          Column({ space: 2 }) {
            ForEach(this.marketEntries, (item: MarketEntry, index: number) => {
              this.marketEntryRow(item, index === this.marketEntries.length - 1)
            }, (item: MarketEntry) => item.name)
          }
          .width('100%')
          .padding({ left: 12, right: 12 })
          .bindSheet($$this.marketDetailOpen, this.marketDetailSheet(), {
            height: '62%',
            dragBar: false,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: this.sheetMaterial() !== undefined ? Color.Transparent : (this.isDark ? '#1C1C1E' : '#F7F8FA'),
            systemMaterial: this.sheetMaterial(),
            onDisappear: () => {
              this.marketDetailOpen = false;
            }
          })
        } else if (!this.marketLoading) {
          Text(this.marketQuery.length > 0 || this.marketCategory.length > 0 ? '没有符合条件的插件' : '此索引没有插件')
            .fontSize(13)
            .fontColor(this.subColor())
            .width('100%')
            .textAlign(TextAlign.Center)
            .padding({ top: 32, bottom: 32 })
        }
        if (this.marketNext.length > 0) {
          Text(this.marketLoading ? '正在加载…' : '显示更多')
            .fontSize(13)
            .fontColor(this.textColor())
            .height(36)
            .padding({ left: 20, right: 20 })
            .borderRadius(8)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' })
            .textAlign(TextAlign.Center)
            .margin({ top: 8, bottom: 12 })
            .onClick(() => {
              if (!this.marketLoading) {
                this.loadMarketEntries(this.marketNext);
              }
            })
        }
      }
    }
    .width('100%')
  }

  private scroller: Scroller = new Scroller();

  build() {
    HdsNavDestination() {
      Column() {
        Scroll(this.scroller) {
          Column({ space: 20 }) {
            // 首屏让出原生标题栏
            Column().width('100%').height((this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 56)
            if (!this.showingMore) {
              Row({ space: 8 }) {
                Text('安装、启用和配置插件')
                  .fontSize(11)
                  .fontColor(this.subColor())
                  .layoutWeight(1)
                if (this.pluginTab === 'installed') {
                  Row() {
                    this.addEntry()
                  }
                  .bindPopup(this.addMenuOpen, {
                    builder: this.addMenuBuilder(),
                    placement: Placement.BottomRight,
                    popupColor: Color.Transparent,
                    enableArrow: false,
                    autoCancel: true,
                    radius: 14,
                    systemMaterial: this.sheetMaterial(),
                    onStateChange: (event) => {
                      if (!event.isVisible) {
                        this.addMenuOpen = false;
                      }
                    }
                  })
                }
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)

              // 分段控件单独一行、靠左（对齐小程序 .plugin-tabs：480rpx 宽 + 靠左）
            Row({ space: 3 }) {
              Text('已安装')
              .fontSize(14)
              .fontWeight(this.pluginTab === 'installed' ? FontWeight.Medium : FontWeight.Normal)
              .fontColor(this.pluginTab === 'installed' ? this.textColor() : this.subColor())
              .layoutWeight(1)
              .textAlign(TextAlign.Center)
              .height(28)
              .borderRadius(8)
              .backgroundColor(this.pluginTab === 'installed'
                ? this.pageBg() : 'rgba(0,0,0,0)')
              .border({ width: this.pluginTab === 'installed' ? 0.5 : 0, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' })
              .onClick(() => {
                this.pluginTab = 'installed';
              })
              Text('发现')
              .fontSize(14)
              .fontWeight(this.pluginTab === 'discover' ? FontWeight.Medium : FontWeight.Normal)
              .fontColor(this.pluginTab === 'discover' ? this.textColor() : this.subColor())
              .layoutWeight(1)
              .textAlign(TextAlign.Center)
              .height(28)
              .borderRadius(8)
              .backgroundColor(this.pluginTab === 'discover'
                ? this.pageBg() : 'rgba(0,0,0,0)')
              .border({ width: this.pluginTab === 'discover' ? 0.5 : 0, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' })
              .onClick(() => {
                this.pluginTab = 'discover';
              })
            }
            .width(240)
            .padding(3)
            .borderRadius(10)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
            // Column 默认居中，这里显式靠左（对齐小程序 align-self: flex-start）
            .alignSelf(ItemAlign.Start)
            }

            if (this.connection !== 'connected') {
              Text('网关未连接，连接后可安装和管理插件')
                .fontSize(12)
                .fontColor(this.isDark ? '#FFB05C' : '#B26A00')
                .width('100%')
                .padding({ left: 12, right: 12, top: 10, bottom: 10 })
                .borderRadius(9)
                .backgroundColor(this.isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.10)')
            }
            if (this.hint.length > 0) {
              Text(this.hint).fontSize(12).fontColor('#FF3B30').width('100%')
            }

            if (this.pluginTab === 'discover' && !this.showingMore) {
              this.marketBody()
            } else if (this.showingMore) {
              Column({ space: 8 }) {
                Text('查看所有实验性插件；启用后会显示在主列表')
                  .fontSize(11)
                  .fontColor(this.subColor())
                  .width('100%')
                ForEach(this.officialBundles(), (item: PluginItem) => {
                  this.bundleRow(item, false)
                }, (item: PluginItem) => item.name)
              }
              .width('100%')
            } else {
              if (this.officialItems.length > 0) {
                Column({ space: 8 }) {
                  this.sectionTitle('内置插件配置', '', false)
                  ForEach(this.officialItems, (item: OfficialPluginItem) => {
                    this.officialRow(item, false)
                  }, (item: OfficialPluginItem) => item.id)
                }
                .width('100%')
              }

              if (this.officialBundles().length > 0) {
                Column({ space: 8 }) {
                  this.sectionTitle('实验性插件', '', true)
                  ForEach(this.featuredBundles(), (item: PluginItem) => {
                    this.bundleRow(item, false)
                  }, (item: PluginItem) => item.name)
                }
                .width('100%')
              }

              Column({ space: 8 }) {
                this.sectionTitle('已安装插件', this.installedBundles().length.toString(), false)
                if (this.installedBundles().length === 0) {
                  Column({ space: 8 }) {
                    if (this.loading) {
                      LoadingProgress().width(22).height(22).color(this.subColor())
                      Text('正在加载插件…').fontSize(11).fontColor(this.subColor())
                    } else {
                      Text('还没有安装第三方插件').fontSize(11).fontColor(this.subColor())
                    }
                  }
                  .width('100%')
                  .padding({ top: 12, bottom: 12 })
                } else {
                  ForEach(this.installedBundles(), (item: PluginItem) => {
                    this.bundleRow(item, false)
                  }, (item: PluginItem) => item.name)
                }
              }
              .width('100%')
            }
          }
          .width('100%')
          .constraintSize({ minHeight: '100%' })
          .justifyContent(FlexAlign.Start)
          .padding({ left: 16, right: 16, top: 14, bottom: 28 })
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        // 平板/宽屏：与其它设置页一致，插件列表居中一栏（对齐 iOS iPad）
        .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })

        .align(Alignment.Top)
        .bindSheet($$this.detailOpen, this.detailSheetContent(), {
          height: '85%',
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.sheetMaterial() !== undefined ? Color.Transparent : (this.isDark ? '#1C1C1E' : '#F7F8FA'),
          systemMaterial: this.sheetMaterial(),
          onDisappear: () => {
            this.detailOpen = false;
          }
        })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
      .bindSheet($$this.addSheetOpen, this.addSheetContent(), {
        height: '72%',
        dragBar: false,
        showClose: false,
        preferType: SheetType.BOTTOM,
        backgroundColor: this.sheetMaterial() !== undefined ? Color.Transparent : (this.isDark ? '#1C1C1E' : '#F7F8FA'),
        systemMaterial: this.sheetMaterial(),
        onDisappear: () => {
          this.addSheetOpen = false;
        }
      })
    }
    .titleBar({
      avoidLayoutSafeArea: true,
      content: { title: { mainTitle: (this.showingMore ? '实验性插件' : '插件') } },
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.GRADIENT_BLUR
        },
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.IMMERSIVE,
          materialLevel: currentGlassMaterialLevel()
        },
        originalStyle: { contentStyle: { titleStyle: { mainTitleColor: $r('sys.color.font_primary') }, menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') } } },
        scrollEffectStyle: { contentStyle: { titleStyle: { mainTitleColor: $r('sys.color.font_primary') }, menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') } } }
      }
    })
    .bindToScrollable([this.scroller])
    .backgroundColor(this.pageBg())
  }

  /** 切到「发现」时拉主机索引源（标题/描述从主机映射） */
  onPluginTabChanged(): void {
    if (this.pluginTab === 'discover') {
      this.loadMarketIndexes();
    }
  }

  private loadMarketIndexes(): void {
    if (!GatewayClient.get().isConnected()) {
      this.marketError = '未连接网关';
      return;
    }
    this.marketLoading = true;
    this.marketError = '';
    GatewayClient.get().requestMarketIndexes().then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      const list: MarketIndex[] = [];
      // 网关实际形状：{ kind, requestId, result: [{ url, title: {en,zh}, description: {en,zh}, error? }] }
      // （兼容老形状 result.indexes / sources，以及纯字符串数组）
      // 兼容三种形态：整帧 {result:[…]}、已解包的数组、{indexes:[…]}/{sources:[…]}
      const resultValue: Object = rec['result'];
      let rows: Object[] = [];
      if (Array.isArray(frame)) {
        rows = frame as Object[];
      } else if (Array.isArray(resultValue)) {
        rows = resultValue as Object[];
      } else if (resultValue !== undefined && resultValue !== null) {
        const nested: Record<string, Object> = this.asRecord(resultValue);
        rows = this.arrField(nested, 'indexes');
        if (rows.length === 0) {
          rows = this.arrField(nested, 'sources');
        }
      }
      for (const raw of rows) {
        if (typeof raw === 'string') {
          const plain: string = raw as string;
          if (plain.length > 0) {
            list.push({ label: plain, url: plain, error: '', description: '' });
          }
          continue;
        }
        const item: Record<string, Object> = this.asRecord(raw);
        const url: string = this.strField(item, 'url');
        if (url.length > 0) {
          const title: string = this.localizedField(item, 'title');
          const description: string = this.localizedField(item, 'description');
          const error: string = this.localizedField(item, 'error');
          list.push({
            label: title.length > 0 ? title : url,
            url: url,
            error: error,
            description: description
          });
        }
      }
      for (const raw of this.arrField(rec, 'sources')) {
        const item: Record<string, Object> = this.asRecord(raw);
        const url: string = this.strField(item, 'url');
        if (url.length > 0 && list.filter((x: MarketIndex) => x.url === url).length === 0) {
          list.push({
            label: this.strField(item, 'label'),
            url: url,
            error: this.strField(item, 'error'),
            description: ''
          });
        }
      }
      this.marketIndexes = list;
      this.marketLoading = false;
      if (list.length > 0) {
        this.marketSelected = list[0].url;
        this.marketLabel = list[0].label.length > 0 ? list[0].label : list[0].url;
        this.loadMarketEntries('');
      }
    }).catch((err: Error) => {
      this.marketLoading = false;
      this.marketError = err.message;
    });
  }

  private loadMarketEntries(cursor: string): void {
    if (this.marketSelected.length === 0) {
      return;
    }
    this.marketLoading = true;
    this.marketError = '';
    GatewayClient.get().searchMarket(this.marketSelected, this.marketQuery.trim(), this.marketCategory, cursor, 30).then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      // 网关实际形状：{ result: { url, title, description, entries: [...], total, nextOffset } }
      // 兼容整帧 {result:{entries}} 与已解包的 {entries}
      const unwrapped: Object = rec['result'];
      const result: Record<string, Object> = unwrapped !== undefined && !Array.isArray(unwrapped)
        ? this.asRecord(unwrapped) : rec;
      // 分类：来自索引自身的 metadata.categories（{ id: { title: {zh,en} } }），对齐小程序分类条
      if (this.marketCategories.length === 0) {
        const meta: Record<string, Object> = this.asRecord(result['metadata']);
        const categoryMap: Record<string, Object> = this.asRecord(meta['categories']);
        const categories: MarketCategory[] = [];
        for (const key of Object.keys(categoryMap)) {
          const one: Record<string, Object> = this.asRecord(categoryMap[key]);
          const title: string = this.localizedField(one, 'title');
          categories.push({ id: key, title: title.length > 0 ? title : key });
        }
        this.marketCategories = categories;
      }
      const entries: MarketEntry[] = [];
      for (const raw of this.arrField(result, 'entries')) {
        const item: Record<string, Object> = this.asRecord(raw);
        const name: string = this.strField(item, 'name');
        if (name.length === 0) {
          continue;
        }
        const versions: Object[] = this.arrField(item, 'versions');
        let version: string = this.strField(item, 'version');
        let installLabel: string = '';
        if (versions.length > 0) {
          const first: Record<string, Object> = this.asRecord(versions[0]);
          if (version.length === 0) {
            version = this.strField(first, 'version');
          }
          installLabel = '';
        }
        const iconFromIndex: string = this.strField(item, 'icon');
        let iconUrl: string = iconFromIndex;
        if (iconUrl.length === 0 && name.indexOf('/') > 0) {
          // owner/repo 形态：用 GitHub 仓库主头像当插件图标（dsh 端市场同款思路）
          iconUrl = 'https://github.com/' + name.substring(0, name.indexOf('/')) + '.png?size=96';
        }
        const repository: Record<string, Object> = this.asRecord(item['repository']);
        const metaRec: Record<string, Object> = this.asRecord(item['metadata']);
        const installation: Record<string, Object> = this.asRecord(item['installation']);
        let packageSpec: string = '';
        let publishDate: string = '';
        if (versions.length > 0) {
          const first: Record<string, Object> = this.asRecord(versions[0]);
          const installRec: Record<string, Object> = this.asRecord(first['install']);
          packageSpec = this.strField(installRec, 'spec');
          const stamp: number = Number(first['publishTimestamp']);
          if (Number.isFinite(stamp) && stamp > 0) {
            const when: Date = new Date(stamp * 1000);
            publishDate = when.getFullYear().toString() + '年' + (when.getMonth() + 1).toString() + '月'
              + when.getDate().toString() + '日';
          }
        }
        entries.push({
          name: name,
          title: this.strField(item, 'title'),
          description: this.localizedField(item, 'description'),
          version: version,
          installLabel: installLabel,
          iconUrl: iconUrl,
          iconFailed: false,
          homepage: this.strField(item, 'homepage'),
          repository: this.strField(repository, 'url'),
          packageSpec: packageSpec,
          publishDate: publishDate,
          categoryId: this.strField(metaRec, 'category'),
          installed: this.strField(installation, 'status') === 'installed'
        });
      }
      this.marketEntries = entries;
      const nextOffset: number = Number(result['nextOffset']);
      this.marketNext = Number.isFinite(nextOffset) && nextOffset > 0 ? nextOffset.toString() : '';
      this.marketLoading = false;
    }).catch((err: Error) => {
      this.marketLoading = false;
      this.marketError = err.message;
    });
  }

  private addMarketSource(): void {
    const url: string = this.marketSourceInput.trim();
    if (url.length === 0) {
      this.marketError = '请输入索引地址';
      return;
    }
    // 网关要求 urls: string[]（不是 {url,label} 对象数组）
    const urls: string[] = [];
    for (const item of this.marketIndexes) {
      if (item.url.length > 0 && urls.indexOf(item.url) < 0) {
        urls.push(item.url);
      }
    }
    if (urls.indexOf(url) < 0) {
      urls.push(url);
    }
    GatewayClient.get().setMarketIndexes(urls).then(() => {
      this.marketSourceOpen = false;
      this.marketSourceInput = '';
      this.loadMarketIndexes();
    }).catch((err: Error) => {
      this.marketError = err.message;
    });
  }

  /** 网络图标加载失败：标记该行回退默认图形 */
  private patchMarketEntry(updated: MarketEntry): void {
    const list: MarketEntry[] = [];
    for (const item of this.marketEntries) {
      list.push(item.name === updated.name ? updated : item);
    }
    this.marketEntries = list;
  }

  private installMarketEntry(item: MarketEntry): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    this.hint = '正在安装 ' + (item.title.length > 0 ? item.title : item.name) + '…';
    GatewayClient.get().installPlugin(item.name, null, true).then((frame) => {
      this.hint = this.frameStatus(frame);
      this.refresh();
    }).catch((err: Error) => {
      this.hint = err.message;
    });
  }

  private refresh(): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关，无法拉取插件目录';
      this.loading = false;
      return;
    }
    this.hint = '';
    this.loading = this.bundles.length === 0;
    GatewayClient.get().requestPlugins();
    setTimeout(() => {
      this.loading = false;
    }, 1500);
  }

  private onToggle(item: PluginItem, enabled: boolean): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    this.pendingName = item.name;
    if (!GatewayClient.get().setPluginEnabled(item.name, enabled)) {
      this.hint = '操作失败，请重试';
      this.pendingName = '';
      return;
    }
    setTimeout(() => {
      this.pendingName = '';
    }, 1200);
  }

  /** 拉取主机提供的 npm 安装源选项（对齐小程序 openAdd → pluginInstaller.registries()） */
  private loadRegistryOptions(): void {
    if (!GatewayClient.get().isConnected() || this.registryLoading) {
      return;
    }
    this.registryLoading = true;
    this.registryError = '';
    GatewayClient.get().requestPluginRegistries().then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      const options: RegistryOption[] = [];
      options.push({ label: '主机默认安装源', value: 'host' });
      const resolved: string = this.strField(rec, 'resolved');
      if (resolved.length > 0) {
        options.push({ label: this.registryLabelFor(resolved), value: resolved });
      }
      for (const raw of this.arrField(rec, 'fallbackRegistries')) {
        if (typeof raw !== 'string') {
          continue;
        }
        const url: string = (raw as string).replace(/\/+$/, '');
        if (url.length === 0 || options.filter((one: RegistryOption) => one.value === url).length > 0) {
          continue;
        }
        options.push({ label: this.registryLabelFor(url), value: url });
      }
      options.push({ label: '自定义地址', value: 'custom' });
      this.registryOptions = options;
      this.registryIndex = 0;
      this.registryLoading = false;
    }).catch((err: Error) => {
      this.registryLoading = false;
      this.registryError = err.message;
    });
  }

  private registryLabelFor(url: string): string {
    if (url.indexOf('registry.npmmirror.com') >= 0) {
      return '中国大陆镜像源';
    }
    if (url.indexOf('registry.npmjs.org') >= 0) {
      return 'npm 官方源';
    }
    return url;
  }

  private currentRegistryValue(): string {
    if (this.registryIndex >= 0 && this.registryIndex < this.registryOptions.length) {
      return this.registryOptions[this.registryIndex].value;
    }
    return 'host';
  }

  private currentRegistryLabel(): string {
    if (this.registryLoading) {
      return '读取中…';
    }
    if (this.registryIndex >= 0 && this.registryIndex < this.registryOptions.length) {
      return this.registryOptions[this.registryIndex].label;
    }
    return '主机默认安装源';
  }

  /** 实际下发给主机的 registry：host/pnpm → null（跟随主机），custom → 输入框内容 */
  private selectedRegistry(): string | null {
    const value: string = this.currentRegistryValue();
    if (value === 'host' || value === 'pnpm') {
      return null;
    }
    if (value === 'custom') {
      const custom: string = this.addRegistryUrl.trim();
      return custom.length > 0 ? custom : null;
    }
    return value;
  }

  @Builder
  registryMenuBuilder() {
    Column() {
      ForEach(this.registryOptions, (option: RegistryOption, index: number) => {
        Row({ space: 8 }) {
          Text(option.label)
            .fontSize(14)
            .fontColor(option.value === this.currentRegistryValue() ? this.accent() : this.textColor())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (option.value === this.currentRegistryValue()) {
            Text('✓').fontSize(14).fontColor(this.accent())
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })
        .onClick(() => {
          this.registryIndex = index;
          this.registryMenuOpen = false;
        })
      }, (option: RegistryOption) => option.value)
      Divider().color(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)')
      Text('Git 仓库和主机目录不通过 npm 安装源下载')
        .fontSize(11)
        .fontColor(this.subColor())
        .padding({ left: 16, right: 16, top: 8, bottom: 10 })
    }
    .width(260)
    .padding({ top: 4, bottom: 4 })
  }

  /** 从索引源列表移除一条（保留其余，按 urls 数组回写） */
  private removeMarketSource(url: string): void {
    const urls: string[] = [];
    for (const item of this.marketIndexes) {
      if (item.url !== url) {
        urls.push(item.url);
      }
    }
    this.sourceSaving = true;
    GatewayClient.get().setMarketIndexes(urls).then(() => {
      this.sourceSaving = false;
      this.marketSelected = '';
      this.marketEntries = [];
      this.loadMarketIndexes();
    }).catch((err: Error) => {
      this.sourceSaving = false;
      this.marketError = err.message;
    });
  }

  /** 管理弹层里添加索引源 */
  private addSourceFromDraft(): void {
    const url: string = this.sourceDraft.trim();
    if (url.length === 0) {
      return;
    }
    this.marketSourceInput = url;
    this.addMarketSource();
    this.sourceDraft = '';
  }

  /** 市场选择菜单：已添加的索引源 + 管理索引源（对齐小程序 market menu） */
  @Builder
  marketMenuBuilder() {
    Column() {
      ForEach(this.marketIndexes, (item: MarketIndex) => {
        Row({ space: 8 }) {
          Text(item.label.length > 0 ? item.label : item.url)
            .fontSize(14)
            .fontColor(item.url === this.marketSelected ? this.accent() : this.textColor())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.url === this.marketSelected) {
            Text('✓').fontSize(14).fontColor(this.accent())
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })
        .onClick(() => {
          this.marketSelected = item.url;
          this.marketLabel = item.label.length > 0 ? item.label : item.url;
          this.marketMenuOpen = false;
          this.loadMarketEntries('');
        })
      }, (item: MarketIndex) => item.url)
      Divider().color(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)')
      Text('管理索引源…')
        .fontSize(14)
        .fontColor(this.textColor())
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })
        .onClick(() => {
          this.marketMenuOpen = false;
          this.sourcesOpen = true;
        })
      Text('＋ 添加索引源')
        .fontSize(14)
        .fontColor(this.accent())
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })
        .onClick(() => {
          this.marketMenuOpen = false;
          this.sourcesOpen = true;
        })
    }
    .width(260)
    .padding({ top: 4, bottom: 4 })
  }

  /** 索引源管理面板（内联在发现页顶部；增删直接回写主机 plugin-market-set-indexes） */
  @Builder
  sourcesPanel() {
    Column() {
      Row() {
        Text('索引源').fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.textColor())
        Blank()
        Text('收起')
          .fontSize(13)
          .fontColor(this.accent())
          .onClick(() => {
            this.sourcesOpen = false;
          })
      }
      .width('100%')
      .padding({ bottom: 6 })
      Text('插件市场以一个索引文件的 URL 提供，「发现」从这里列出的索引浏览插件')
        .fontSize(11)
        .fontColor(this.subColor())
        .width('100%')
        .padding({ bottom: 8 })
      ForEach(this.marketIndexes, (item: MarketIndex) => {
        Row({ space: 8 }) {
          Column({ space: 2 }) {
            Text(item.label.length > 0 ? item.label : item.url)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.textColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(item.url)
              .fontSize(11)
              .fontColor(this.subColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('删除')
            .fontSize(12)
            .fontColor('#FF3B30')
            .onClick(() => {
              this.removeMarketSource(item.url);
            })
        }
        .width('100%')
        .padding({ top: 8, bottom: 8 })
        .alignItems(VerticalAlign.Center)
      }, (item: MarketIndex) => item.url)
      Row({ space: 8 }) {
        TextInput({ text: this.sourceDraft, placeholder: 'https://example.com/index.json' })
          .fontSize(13)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor('rgba(0,0,0,0)')
          .borderRadius(8)
          .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' })
          .height(38)
          .layoutWeight(1)
          .onChange((value: string) => {
            this.sourceDraft = value;
          })
        Text('＋ 添加')
          .fontSize(13)
          .fontColor('#FFFFFF')
          .height(38)
          .padding({ left: 14, right: 14 })
          .textAlign(TextAlign.Center)
          .borderRadius(8)
          .backgroundColor(this.accent())
          .opacity(this.sourceDraft.trim().length === 0 ? 0.5 : 1)
          .onClick(() => {
            this.addSourceFromDraft();
          })
      }
      .width('100%')
      .padding({ top: 8 })
      Text('索引由第三方提供。只添加你信任的来源：其中的插件安装后以你的权限运行')
        .fontSize(11)
        .lineHeight(16)
        .fontColor(this.isDark ? '#FFB05C' : '#B26A00')
        .width('100%')
        .padding(10)
        .margin({ top: 8 })
        .borderRadius(10)
        .backgroundColor(this.isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.10)')
    }
    .width('100%')
    .padding(12)
    .borderRadius(12)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 12 })
  }

  /** 索引源管理弹层：标题 + 列表（名称/URL/错误 + 删除）+ 添加表单 + 信任提示 */
  @Builder
  sourcesSheetContent() {
    Column() {
      Column()
        .width(36)
        .height(4)
        .borderRadius(2)
        .margin({ top: 8, bottom: 6 })
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)')

      Row() {
        Text('索引源').fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.textColor())
        Blank()
        Text('×')
          .fontSize(20)
          .fontColor(this.subColor())
          .width(36)
          .height(36)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.sourcesOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 18, right: 12, bottom: 4 })

      Text('插件市场以一个索引文件的 URL 提供，「发现」从这里列出的索引浏览插件')
        .fontSize(12)
        .fontColor(this.subColor())
        .width('100%')
        .padding({ left: 18, right: 18, bottom: 12 })

      Scroll() {
        Column({ space: 8 }) {
          ForEach(this.marketIndexes, (item: MarketIndex) => {
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Text(item.label.length > 0 ? item.label : item.url)
                  .fontSize(14)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (item.description.length > 0) {
                  Text(item.description)
                    .fontSize(11)
                    .fontColor(this.subColor())
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                Text(item.url)
                  .fontSize(11)
                  .fontColor(this.subColor())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (item.error.length > 0) {
                  Text(item.error).fontSize(11).fontColor('#FF3B30')
                }
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text('🗑')
                .fontSize(15)
                .fontColor(this.subColor())
                .width(32)
                .height(32)
                .textAlign(TextAlign.Center)
                .opacity(this.sourceSaving ? 0.4 : 1)
                .onClick(() => {
                  if (!this.sourceSaving) {
                    this.removeMarketSource(item.url);
                  }
                })
            }
            .width('100%')
            .padding({ left: 12, right: 8, top: 10, bottom: 10 })
            .borderRadius(10)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
            .alignItems(VerticalAlign.Center)
          }, (item: MarketIndex) => item.url)
        }
        .width('100%')
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 18, right: 18 })
      .scrollBar(BarState.Off)
      .align(Alignment.Top)

      Row({ space: 8 }) {
        TextInput({ text: this.sourceDraft, placeholder: 'https://example.com/index.json' })
          .fontSize(13)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor('rgba(0,0,0,0)')
          .borderRadius(8)
          .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' })
          .height(40)
          .layoutWeight(1)
          .onChange((value: string) => {
            this.sourceDraft = value;
          })
        Text(this.sourceSaving ? '保存中…' : '＋ 添加')
          .fontSize(13)
          .fontColor('#FFFFFF')
          .height(40)
          .padding({ left: 14, right: 14 })
          .textAlign(TextAlign.Center)
          .borderRadius(8)
          .backgroundColor(this.accent())
          .opacity(this.sourceSaving || this.sourceDraft.trim().length === 0 ? 0.5 : 1)
          .onClick(() => {
            if (!this.sourceSaving) {
              this.addSourceFromDraft();
            }
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 10 })

      Row({ space: 8 }) {
        Text('!')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.isDark ? '#FFB05C' : '#B26A00')
        Text('索引由第三方提供。只添加你信任的来源：其中的插件安装后以你的权限运行')
          .fontSize(11)
          .lineHeight(16)
          .fontColor(this.isDark ? '#FFB05C' : '#B26A00')
          .layoutWeight(1)
      }
      .width('calc(100% - 36vp)')
      .margin({ left: 18, right: 18, top: 12, bottom: 16 })
      .padding(10)
      .borderRadius(10)
      .backgroundColor(this.isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.10)')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pageBg())
  }

  private runInstall(): void {
    const spec: string = this.addSpec.trim();
    if (spec.length === 0) {
      this.addError = '请输入包名、Git 地址或主机目录';
      return;
    }
    if (!GatewayClient.get().isConnected()) {
      this.addError = '未连接网关';
      return;
    }
    const registry: string | null = this.selectedRegistry();
    this.addBusy = true;
    this.addError = '';
    this.addStatus = '正在检查插件…';
    GatewayClient.get().inspectPlugin(spec, registry !== null ? registry : undefined).catch((err: Error) => {
      this.addStatus = '';
    }).then(() => {
      this.addStatus = '正在安装…';
      return GatewayClient.get().installPlugin(spec, registry, this.addEnableAfter);
    }).then((frame) => {
      this.addBusy = false;
      const frameRec: Record<string, Object> = this.asRecord(frame);
      const logs: string = this.strField(frameRec, 'logs');
      this.addLogs = logs;
      const newInstallId: string = this.strField(frameRec, 'installId');
      if (newInstallId.length > 0) {
        this.installId = newInstallId;
      }
      const status: string = this.frameStatus(frame);
      this.addStatus = status.length > 0 ? status : '安装完成';
      this.addSpec = '';
      this.refresh();
    }).catch((err: Error) => {
      this.addBusy = false;
      this.addStatus = '';
      this.addError = err.message;
    });
  }

  private openOfficialDetail(item: OfficialPluginItem): void {
    this.detailOpen = true;
    this.detailName = item.id;
    this.detailTitle = item.title;
    this.detailVersion = '';
    this.detailDescription = item.description;
    this.detailEnabled = true;
    this.detailUpdateAvailable = false;
    this.detailEntries = [];
    this.detailError = '';
    this.detailSaved = '';
    this.detailMarkdown = '';
    this.detailKind = item.id;
    this.detailFields = [];
    this.detailBusy = true;
    this.webApiEnabled = false;
    this.apiKeyText = '';
    this.apiKeyConfigured = false;
    this.apiKeyHint = '';
    if (item.id === 'web-search') {
      this.loadWebApiState();
      this.loadApiKeyState();
    }
    this.loadOfficialSettings(item.id);
    GatewayClient.get().requestPluginDetail(item.id, 'zh').then((frame) => {
      const markdown: string = this.extractMarkdown(frame);
      if (markdown.length > 0) {
        this.detailMarkdown = markdown;
      }
    }).catch((err: Error) => {
      // 部分内置项没有文档，忽略
    });
  }

  private fieldSpecs(kind: string): string[][] {
    if (kind === 'shell') {
      return [
        ['timeoutMs', '命令超时（毫秒）', '单条命令允许运行多久，超时即终止。'],
        ['maxOutputBytes', '单流输出上限（字节）', '超出部分会转存到临时文件，而不是被丢弃。']
      ];
    }
    if (kind === 'agent-loop') {
      return [['maxParallelToolCalls', '并行工具调用数', '同一步内最多同时运行多少个可并行的调用。']];
    }
    if (kind === 'subagent') {
      return [
        ['maxDepth', '子智能体递归层级', '设置子智能体最多可以递归多少层。'],
        ['maxActiveSubagents', '同时活跃子智能体', '限制同一时间运行的子智能体数量。']
      ];
    }
    if (kind === 'web-search') {
      return [
        ['baseURL', '接口地址', '搜索接口的基础地址，留空使用默认值。'],
        ['maxUses', '单次搜索次数上限', '一次会话里最多调用多少次搜索。']
      ];
    }
    return [];
  }

  private readFieldValue(value: Object | undefined, key: string): string {
    if (value === undefined) {
      return '';
    }
    const rec: Record<string, Object> = this.asRecord(value);
    const raw: Object = rec[key];
    if (typeof raw === 'number') {
      return (raw as number).toString();
    }
    if (typeof raw === 'string') {
      return raw as string;
    }
    if (typeof raw === 'boolean') {
      return (raw as boolean) ? 'true' : 'false';
    }
    return '';
  }

  /** 字段标签/说明：主机 schema 只有类型和默认值，文案在这里映射（与 dsh 端一致） */
  private fieldLabel(key: string): string {
    const labels: Record<string, string> = {
      'cwd': '工作目录',
      'timeoutMs': '命令超时（毫秒）',
      'maxTimeoutMs': '最长超时（毫秒）',
      'maxOutputBytes': '单流输出上限（字节）',
      'maxSpillBytes': '溢出文件上限（字节）',
      'graceMs': '终止宽限（毫秒）',
      'maxDepth': '子智能体递归层级',
      'maxActiveSubagents': '同时活跃子智能体',
      'maxSteps': '单轮最大步数',
      'baseURL': '接口地址',
      'model': '模型',
      'maxUses': '单次搜索次数上限',
      'maxTokens': '最大输出 token',
      'apiVersion': '接口版本'
    };
    const label: string = labels[key] ?? '';
    return label.length > 0 ? label : key;
  }

  private fieldHint(key: string): string {
    const hints: Record<string, string> = {
      'cwd': '命令默认在哪个目录下执行，留空使用会话工作区。',
      'timeoutMs': '单条命令允许运行多久，超时即终止。',
      'maxTimeoutMs': '模型可以为单条命令申请的最长超时。',
      'maxOutputBytes': '超出部分会转存到临时文件，而不是被丢弃。',
      'maxSpillBytes': '单次命令输出转存到文件的上限。',
      'graceMs': '超时后等待进程退出的宽限时间。',
      'maxDepth': '设置子智能体最多可以递归多少层。',
      'maxActiveSubagents': '限制同一时间运行的子智能体数量。',
      'maxSteps': '单轮对话里最多派发多少次工具调用。',
      'maxUses': '一次会话里最多调用多少次搜索。'
    };
    return hints[key] ?? '';
  }

  /** 按主机 schema 的 dict 生成字段（主机加字段会自动出现） */
  private buildSchemaFields(ns: string, namespace: PluginNamespace): PluginField[] {
    const fields: PluginField[] = [];
    const schemaValue: Object | undefined = namespace.schema;
    if (schemaValue === undefined) {
      return fields;
    }
    const schema: Record<string, Object> = this.asRecord(schemaValue);
    const refs: Record<string, Object> = this.asRecord(schema['refs']);
    const root: Record<string, Object> = this.asRecord(refs[String(Number(schema['uid']))]);
    const dict: Record<string, Object> = this.asRecord(root['dict']);
    for (const key of Object.keys(dict)) {
      const ref: Record<string, Object> = this.asRecord(refs[String(Number(dict[key]))]);
      const type: string = this.strField(ref, 'type');
      if (type !== 'number' && type !== 'string' && type !== 'boolean') {
        continue;
      }
      const meta: Record<string, Object> = this.asRecord(ref['meta']);
      const role: string = this.strField(meta, 'role');
      if (role.length > 0) {
        continue;
      }
      fields.push({
        ns: ns,
        key: key,
        label: this.fieldLabel(key),
        hint: this.fieldHint(key),
        numeric: type === 'number',
        value: this.readFieldValue(namespace.value, key),
        revision: namespace.revision
      });
    }
    return fields;
  }

  private buildFields(kind: string, ns: string, namespace: PluginNamespace): PluginField[] {
    const dynamic: PluginField[] = this.buildSchemaFields(ns, namespace);
    if (dynamic.length > 0) {
      return dynamic;
    }
    const specs: string[][] = this.fieldSpecs(kind);
    const fields: PluginField[] = [];
    for (const spec of specs) {
      fields.push({
        ns: ns,
        key: spec[0],
        label: spec[1],
        hint: spec[2],
        numeric: true,
        value: this.readFieldValue(namespace.value, spec[0]),
        revision: namespace.revision
      });
    }
    return fields;
  }

  private loadOfficialSettings(kind: string): void {
    const candidates: string[] = kind === 'shell'
      ? ['pwsh-sandbox', 'bash-sandbox']
      : kind === 'agent-loop' ? ['agent-loop']
      : kind === 'subagent' ? ['subagent']
      : kind === 'web-search' ? ['web-search-deepseek', 'web-deepseek-api', 'web'] : [];
    if (candidates.length === 0) {
      this.detailBusy = false;
      this.detailError = '该内置插件需要在桌面端 DSH 配置';
      return;
    }
    this.tryLoadSettings(kind, candidates, 0);
  }

  private tryLoadSettings(kind: string, candidates: string[], index: number): void {
    if (index >= candidates.length) {
      this.detailBusy = false;
      this.detailError = '当前网关未提供该插件的设置项';
      return;
    }
    GatewayClient.get().requestPluginSettings(candidates[index]).then((frame) => {
      const ns: PluginNamespace = parseNamespace(frame);
      Logger.info('[SCHEMA] ns=' + candidates[index] + ' schema=' + JSON.stringify(ns.schema).substring(0, 1800));
      if (!ns.valid) {
        this.tryLoadSettings(kind, candidates, index + 1);
        return;
      }
      this.detailFields = this.buildFields(kind, candidates[index], ns);
      this.detailBusy = false;
    }).catch((err: Error) => {
      this.tryLoadSettings(kind, candidates, index + 1);
    });
  }

  private setFieldValue(index: number, text: string): void {
    if (index < 0 || index >= this.detailFields.length) {
      return;
    }
    const current: PluginField = this.detailFields[index];
    const updated: PluginField = {
      ns: current.ns, key: current.key, label: current.label, hint: current.hint,
      numeric: current.numeric, value: text, revision: current.revision
    };
    this.detailFields[index] = updated;
  }

  private toggleEntry(entry: EntryRow, enabled: boolean): void {
    if (!GatewayClient.get().isConnected()) {
      this.detailError = '未连接网关';
      return;
    }
    const updated: EntryRow = {
      id: entry.id, name: entry.name, description: entry.description,
      enabled: enabled, moduleLine: entry.moduleLine, phase: entry.phase, packageName: entry.packageName
    };
    const list: EntryRow[] = [];
    for (const item of this.detailEntries) {
      list.push(item.id === entry.id ? updated : item);
    }
    this.detailEntries = list;
    GatewayClient.get().setPluginEntryEnabled(entry.id, enabled).catch((err: Error) => {
      this.detailError = err.message.length > 0 ? err.message : '组件开关保存失败';
    });
  }

  private cancelInstallRun(): void {
    if (this.installId.length === 0) {
      this.addError = '当前没有可取消的安装任务';
      return;
    }
    this.addStatus = '正在取消安装…';
    GatewayClient.get().cancelPluginInstall(this.installId).then((frame) => {
      this.addBusy = false;
      this.addStatus = this.frameStatus(frame);
      this.addLogs = '';
    }).catch((err: Error) => {
      this.addStatus = '';
      this.addError = err.message.length > 0 ? err.message : '取消安装失败';
    });
  }

  private reconcileInstallRun(): void {
    if (this.installId.length === 0) {
      this.addError = '当前没有可核对的安装任务';
      return;
    }
    this.addStatus = '正在核对安装状态…';
    GatewayClient.get().requestPluginInstallStatus(this.installId).then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      const text: string = this.frameStatus(frame);
      this.addStatus = text.length > 0 ? text : '安装状态已刷新';
      const logs: string = this.strField(rec, 'logs');
      if (logs.length > 0) {
        this.addLogs = logs;
      }
      const phase: string = this.strField(rec, 'phase');
      if (phase === 'done' || phase === 'failed' || phase === 'cancelled') {
        this.addBusy = false;
        this.refresh();
      }
    }).catch((err: Error) => {
      this.addStatus = '';
      this.addError = err.message.length > 0 ? err.message : '查询安装状态失败';
    });
  }

  private loadWebApiState(): void {
    GatewayClient.get().requestPluginSettings('web').then((frame) => {
      const ns: PluginNamespace = parseNamespace(frame);
      if (!ns.valid || ns.value === undefined) {
        return;
      }
      const rec: Record<string, Object> = this.asRecord(ns.value);
      const provider: string = this.strField(rec, 'searchProvider');
      this.webApiEnabled = provider === 'deepseek-search-api';
    }).catch((err: Error) => {
    });
  }

  private toggleWebApi(enabled: boolean): void {
    this.webApiBusy = true;
    GatewayClient.get().requestPluginSettings('web').then((frame) => {
      const ns: PluginNamespace = parseNamespace(frame);
      if (!ns.valid) {
        throw new Error('当前网关未提供搜索设置');
      }
      const ops: SettingsOp[] = [
        { op: 'set', path: ['searchProvider'], value: enabled ? 'deepseek-search-api' : 'deepseek-official' },
        { op: 'set', path: ['fetchProvider'], value: enabled ? 'deepseek-fetch-api' : 'http' }
      ];
      return GatewayClient.get().mutatePluginSettings('web', ns.revision, ops as Object[]);
    }).then(() => {
      this.webApiBusy = false;
      this.webApiEnabled = enabled;
    }).catch((err: Error) => {
      this.webApiBusy = false;
      this.detailError = err.message.length > 0 ? err.message : '切换搜索方式失败';
    });
  }

  private loadApiKeyState(): void {
    GatewayClient.get().describePluginCredential('DEEPSEEK_API_KEY').then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      this.apiKeyConfigured = this.readBool(rec, 'configured');
      this.apiKeyWritable = this.readBool(rec, 'writable') || true;
      const unavailable: Object = rec['unavailable'];
      this.apiKeyHint = unavailable !== undefined && (unavailable as boolean)
        ? '当前网关尚未开放凭据接口'
        : (this.apiKeyConfigured ? '已配置凭据' : '尚未配置凭据');
    }).catch((err: Error) => {
      this.apiKeyHint = '当前网关尚未开放凭据接口';
      this.apiKeyWritable = false;
    });
  }

  private saveApiKey(): void {
    const secret: string = this.apiKeyText.trim();
    if (secret.length === 0) {
      this.apiKeyHint = '请输入 API Key';
      return;
    }
    this.apiKeyHint = '正在保存…';
    GatewayClient.get().setPluginCredential('DEEPSEEK_API_KEY', secret).then(() => {
      this.apiKeyText = '';
      this.apiKeyConfigured = true;
      this.apiKeyHint = '已保存凭据';
    }).catch((err: Error) => {
      this.apiKeyHint = err.message.length > 0 ? err.message : '保存凭据失败';
    });
  }

  private resetField(field: PluginField): void {
    if (this.detailSaving) {
      return;
    }
    this.detailSaving = true;
    this.detailError = '';
    const op: SettingsOp = { op: 'unset', path: [field.key], value: '' };
    GatewayClient.get().mutatePluginSettings(field.ns, field.revision, [op] as Object[]).then(() => {
      this.detailSaving = false;
      this.detailSaved = '已恢复默认';
      this.loadOfficialSettings(this.detailKind);
    }).catch((err: Error) => {
      this.detailSaving = false;
      this.detailError = err.message.length > 0 ? err.message : '恢复默认失败';
    });
  }

  private saveOfficialSettings(): void {
    if (this.detailFields.length === 0) {
      return;
    }
    const ns: string = this.detailFields[0].ns;
    const revision: number = this.detailFields[0].revision;
    const ops: SettingsOp[] = [];
    for (const field of this.detailFields) {
      const text: string = field.value.trim();
      if (text.length === 0) {
        continue;
      }
      const parsed: number = Number.parseInt(text, 10);
      const op: SettingsOp = {
        op: 'set',
        path: [field.key],
        value: field.numeric && !Number.isNaN(parsed) ? parsed : text
      };
      ops.push(op);
    }
    if (ops.length === 0) {
      this.detailError = '没有需要保存的修改';
      return;
    }
    this.detailSaving = true;
    this.detailError = '';
    GatewayClient.get().mutatePluginSettings(ns, revision, ops as Object[]).then(() => {
      this.detailSaving = false;
      this.detailSaved = '已保存';
      this.loadOfficialSettings(this.detailKind);
    }).catch((err: Error) => {
      this.detailSaving = false;
      this.detailError = err.message.length > 0 ? err.message : '保存失败，请重试';
    });
  }

  private openDetail(item: PluginItem): void {
    this.detailOpen = true;
    this.detailName = item.name;
    this.detailTitle = item.title;
    this.detailVersion = item.version;
    this.detailDescription = item.description;
    this.detailEnabled = item.enabled;
    this.detailUpdateAvailable = item.updateAvailable;
    this.detailCheckState = '';
    this.detailNewVersion = '';
    this.detailUpdateNote = '';
    // 安装来源 / 目标版本（对齐 dsh 端「当前 DSH 对应来源/版本」）+ 只读原因
    this.detailInstallSpec = item.installSpec;
    this.detailSourceSpec = item.sourceSpec;
    this.detailTargetVersion = item.installTargetVersion;
    this.detailReadOnlyReason = item.readOnlyReason;
    if (item.updateAvailable && item.installTargetVersion.length > 0) {
      this.detailNewVersion = item.installTargetVersion;
      this.detailCheckState = 'available';
    }
    this.detailExperimental = item.experimental;
    // 包含的组件：静态 rows × 实时组件状态（目录帧实时推送，dsh 端变化自动跟随）
    this.detailEntries = this.buildEntriesFor(item);
    // 功能选项：候选命名空间 = 包名 / 短名 / 各组件 id（dsh 端设置文档落在其中之一）
    const candidates: string[] = [item.name];
    const slash: number = item.name.lastIndexOf('/');
    if (slash >= 0 && slash + 1 < item.name.length) {
      candidates.push(item.name.substring(slash + 1));
    }
    for (const entry of this.detailEntries) {
      if (entry.id.length > 0) {
        candidates.push(entry.id);
      }
    }
    this.loadBundleSettings(candidates);
    this.detailError = '';
    this.detailSaved = '';
    this.detailMarkdown = '';
    this.detailKind = '';
    this.detailFields = [];
    this.webApiEnabled = false;
    this.apiKeyText = '';
    this.apiKeyConfigured = false;
    this.apiKeyHint = '';
    this.detailBusy = true;
    GatewayClient.get().requestPluginDetail(item.name, 'zh').then((frame) => {
      this.detailBusy = false;
      this.detailMarkdown = this.extractMarkdown(frame);
      const rec: Record<string, Object> = this.asRecord(frame);
      const version: string = this.strField(rec, 'version');
      if (version.length > 0) {
        this.detailVersion = version;
      }
      const description: string = this.strField(rec, 'description');
      if (description.length > 0) {
        this.detailDescription = description;
      }
      // plugin-detail 帧只带 Markdown；组件列表来自目录 rows × 实时状态，
      // 这里仅在目录没给出 rows 时兜底解析（避免用空 items 把已构建的列表清掉）
      if (this.detailEntries.length === 0) {
        const entries: EntryRow[] = [];
        for (const raw of this.arrField(rec, 'items')) {
          const entry: Record<string, Object> = this.asRecord(raw);
          const id: string = this.strField(entry, 'entryId') || this.strField(entry, 'id');
          const name: string = this.strField(entry, 'name') || id;
          if (id.length > 0) {
            const moduleId: string = this.strField(entry, 'moduleName');
            const moduleLine: string = moduleId.length > 0 ? id + ' · ' + moduleId : id;
            entries.push({
              id: id,
              name: name,
              description: this.localizedField(entry, 'description'),
              enabled: this.readBool(entry, 'enabled'),
              moduleLine: moduleLine,
              phase: this.strField(entry, 'fiberPhase'),
              packageName: this.strField(entry, 'packageName') || this.strField(entry, 'plugin')
            });
          }
        }
        this.detailEntries = entries;
      }
    }).catch((err: Error) => {
      this.detailBusy = false;
      this.detailError = err.message;
    });
  }

  /** dsh 端设置变化：详情开着时静默重载当前内置插件的功能选项 */
  private onSettingsRevChanged(): void {
    if (!this.detailOpen || this.detailSaving) {
      return;
    }
    // 内置插件：按 kind 的候选命名空间静默重载
    if (this.detailKind.length > 0 && this.detailKind !== 'web-search' && this.detailFields.length > 0) {
      const candidates: string[] = this.detailKind === 'shell'
        ? ['pwsh-sandbox', 'bash-sandbox']
        : this.detailKind === 'agent-loop' ? ['agent-loop']
        : this.detailKind === 'subagent' ? ['subagent']
        : [];
      if (candidates.length > 0) {
        this.tryLoadSettingsSilent(this.detailKind, candidates, 0);
      }
      return;
    }
    // 插件包（detailKind===''）：功能选项静默重载（候选命名空间同 openDetail）
    if (this.detailKind === '' && this.detailName.length > 0 && this.detailEntries.length > 0) {
      const candidates: string[] = [this.detailName];
      const slash: number = this.detailName.lastIndexOf('/');
      if (slash >= 0 && slash + 1 < this.detailName.length) {
        candidates.push(this.detailName.substring(slash + 1));
      }
      for (const entry of this.detailEntries) {
        if (entry.id.length > 0) {
          candidates.push(entry.id);
        }
      }
      this.loadBundleSettings(candidates);
    }
  }

  /** 插件包的功能选项：依次尝试候选命名空间（包名/短名/组件 id），取值非空即渲染 */
  private loadBundleSettings(candidates: string[]): void {
    const seen: string[] = [];
    for (const one of candidates) {
      if (one.length > 0 && seen.indexOf(one) < 0) {
        seen.push(one);
      }
    }
    const tryOne = (index: number): void => {
      if (index >= seen.length) {
        return;
      }
      const ns: string = seen[index];
      GatewayClient.get().requestPluginSettings(ns).then((frame) => {
        const namespace: PluginNamespace = parseNamespace(frame);
        if (!namespace.valid || namespace.value === undefined) {
          tryOne(index + 1);
          return;
        }
        const valueRec: Record<string, Object> | undefined = this.asRecord(namespace.value);
        if (valueRec === undefined) {
          tryOne(index + 1);
          return;
        }
        const keys: string[] = Object.keys(valueRec);
        if (keys.length === 0) {
          tryOne(index + 1);
          return;
        }
        const fields: PluginField[] = [];
        for (const key of keys) {
          fields.push({
            ns: ns,
            key: key,
            label: key,
            hint: '',
            numeric: false,
            value: this.readFieldValue(valueRec, key),
            revision: namespace.revision
          });
        }
        this.detailFields = fields;
      }).catch(() => {
        tryOne(index + 1);
      });
    };
    tryOne(0);
  }

  private tryLoadSettingsSilent(kind: string, candidates: string[], index: number): void {
    if (index >= candidates.length) {
      return;
    }
    GatewayClient.get().requestPluginSettings(candidates[index]).then((frame) => {
      const ns: PluginNamespace = parseNamespace(frame);
      if (!ns.valid) {
        this.tryLoadSettingsSilent(kind, candidates, index + 1);
        return;
      }
      // 只更新取值，不重置用户正在编辑的输入框状态以外的结构
      this.detailFields = this.buildFields(kind, candidates[index], ns);
    }).catch(() => {
      this.tryLoadSettingsSilent(kind, candidates, index + 1);
    });
  }

  /** dsh 端插件变化：目录已实时刷新，这里把打开中的详情从最新目录重建（组件状态/启停/版本） */
  private onCatalogRevChanged(): void {
    if (!this.detailOpen || this.detailName.length === 0 || this.detailKind.length > 0) {
      return;
    }
    const item: PluginItem | undefined = this.bundles.find(b => b.name === this.detailName);
    if (item === undefined) {
      return;
    }
    this.detailVersion = item.version.length > 0 ? item.version : this.detailVersion;
    this.detailEnabled = item.enabled;
    this.detailEntries = this.buildEntriesFor(item);
  }

  /** 静态 rows × 实时组件状态 → 详情「包含的组件」行（对齐 weapp buildRow） */
  private buildEntriesFor(item: PluginItem): EntryRow[] {
    const rows: EntryRow[] = [];
    for (const row of item.rows) {
      const live: CatalogEntry | undefined = this.catalogEntries.find(x =>
        x.entryId === row.entryId || x.entryId === row.rowId);
      const id: string = row.entryId.length > 0 ? row.entryId : row.rowId;
      const name: string = live !== undefined && live.name.length > 0 ? live.name : row.name;
      const description: string = live !== undefined && live.description.length > 0 ? live.description : row.description;
      const moduleLine: string = row.moduleName.length > 0 ? id + ' · ' + row.moduleName : id;
      rows.push({
        id: id,
        name: name,
        description: description,
        enabled: live !== undefined ? live.enabled : false,
        moduleLine: moduleLine,
        phase: live !== undefined ? live.fiberPhase : '',
        packageName: item.name
      });
    }
    return rows;
  }

  /** 组件运行状态（对齐 weapp buildRow statusText） */
  private entryStatusText(entry: EntryRow): string {
    if (!entry.enabled) {
      return '已停用';
    }
    if (entry.phase === 'active') return '运行中';
    if (entry.phase === 'failed') return '运行失败';
    if (entry.phase === 'loading') return '加载中';
    if (entry.phase === 'unloading') return '卸载中';
    if (entry.phase === 'pending') return '待启动';
    return '空闲';
  }

  private entryRunning(entry: EntryRow): boolean {
    return entry.enabled && entry.phase === 'active';
  }

  private runningEntryCount(): number {
    let count: number = 0;
    for (const entry of this.detailEntries) {
      if (this.entryRunning(entry)) {
        count += 1;
      }
    }
    return count;
  }

  /** 版本状态文案（对齐 dsh 端详情：检查更新 / 已是最新 / 可更新到 x / 正在更新） */
  private updateStateText(): string {
    if (this.detailCheckState === 'checking') {
      return '正在检查更新…';
    }
    if (this.detailCheckState === 'latest') {
      return '已是最新版本';
    }
    if (this.detailCheckState === 'available') {
      return '可更新到 v' + this.detailNewVersion;
    }
    if (this.detailCheckState === 'updating') {
      return this.detailUpdateNote.length > 0 ? this.detailUpdateNote : '正在更新…';
    }
    if (this.detailCheckState === 'done') {
      return this.detailUpdateNote;
    }
    if (this.detailCheckState === 'error') {
      return this.detailUpdateNote;
    }
    return '检查是否有新版本';
  }

  private compareVersions(a: string, b: string): number {
    const pa: string[] = a.split('-')[0].split('.');
    const pb: string[] = b.split('-')[0].split('.');
    const len: number = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x: number = i < pa.length ? parseInt(pa[i], 10) : 0;
      const y: number = i < pb.length ? parseInt(pb[i], 10) : 0;
      const na: number = isNaN(x) ? 0 : x;
      const nb: number = isNaN(y) ? 0 : y;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  /** 检查更新（plugin-versions）：与当前版本比较，出现更高版本时给出「更新」入口 */
  private checkDetailUpdate(): void {
    if (!GatewayClient.get().isConnected()) {
      this.detailError = '未连接网关';
      return;
    }
    this.detailCheckState = 'checking';
    this.detailNewVersion = '';
    GatewayClient.get().requestPluginVersions(this.detailName).then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      const raw: Object | undefined = rec['result'];
      const result: Record<string, Object> | undefined = this.asRecord(raw);
      const versions: string[] = [];
      let list: Object[] = [];
      if (Array.isArray(raw)) {
        list = raw as Object[];
      } else if (result !== undefined && Array.isArray(result['versions'])) {
        list = result['versions'] as Object[];
      }
      for (const item of list) {
        if (typeof item === 'string') {
          versions.push(item as string);
          continue;
        }
        const one = this.asRecord(item);
        if (one !== undefined) {
          const v: string = this.strField(one, 'version');
          if (v.length > 0) {
            versions.push(v);
          }
        }
      }
      let newest: string = this.detailVersion;
      for (const v of versions) {
        if (this.compareVersions(v, newest) > 0) {
          newest = v;
        }
      }
      if (versions.length === 0) {
        this.detailCheckState = 'error';
        const refused: string = result !== undefined ? this.strField(result, 'error') ?? this.strField(result, 'message') ?? '' : '';
        this.detailUpdateNote = refused.length > 0 ? refused : '无法检查更新';
        return;
      }
      if (this.compareVersions(newest, this.detailVersion) > 0) {
        this.detailNewVersion = newest;
        this.detailCheckState = 'available';
      } else {
        this.detailCheckState = 'latest';
      }
    }).catch((err: Error) => {
      this.detailCheckState = 'error';
      this.detailUpdateNote = err.message.length > 0 ? err.message : '无法检查更新';
    });
  }

  /** 执行更新（plugin-update）：完成后刷新目录，dsh 端会同步收到变化 */
  private runDetailUpdate(): void {
    if (this.detailNewVersion.length === 0 || this.detailUpdating) {
      return;
    }
    if (!GatewayClient.get().isConnected()) {
      this.detailError = '未连接网关';
      return;
    }
    const to: string = this.detailNewVersion.length > 0 ? this.detailNewVersion : this.detailTargetVersion;
    this.detailCheckState = 'updating';
    this.detailUpdateNote = '正在更新到 v' + to + '，期间插件可能短暂停止';
    this.detailUpdating = true;
    GatewayClient.get().updatePlugin(this.detailName, to).then(() => {
      this.detailUpdating = false;
      this.detailVersion = to;
      this.detailCheckState = 'done';
      this.detailUpdateNote = '已更新到 v' + to;
      this.refresh();
    }).catch((err: Error) => {
      this.detailUpdating = false;
      this.detailCheckState = 'error';
      this.detailUpdateNote = err.message.length > 0 ? err.message : '更新失败，请重试';
    });
  }

  private setDetailEnabled(enabled: boolean): void {
    if (!GatewayClient.get().isConnected()) {
      this.detailError = '未连接网关';
      return;
    }
    this.detailBusy = true;
    const ok: boolean = GatewayClient.get().setPluginEnabled(this.detailName, enabled);
    this.detailEnabled = enabled;
    setTimeout(() => {
      this.detailBusy = false;
      if (!ok) {
        this.detailError = '操作失败，请重试';
      }
    }, 900);
  }

  private uninstallDetail(): void {
    if (!GatewayClient.get().isConnected()) {
      this.detailError = '未连接网关';
      return;
    }
    this.detailBusy = true;
    GatewayClient.get().removePlugin(this.detailName).then(() => {
      this.detailBusy = false;
      this.detailOpen = false;
      this.refresh();
    }).catch((err: Error) => {
      this.detailBusy = false;
      this.detailError = err.message;
    });
  }
}
