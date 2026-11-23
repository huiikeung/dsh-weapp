import { NavBackButton } from '../components/NavBackButton';
import { uiMaterial } from '@kit.ArkUI';
import { GatewayClient, OfficialPluginItem, PluginItem, parseNamespace } from 'nativecore';
import { MarkdownBodyView } from '../components/MarkdownBodyView';
import type { PluginNamespace } from 'nativecore';

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
}

interface EntryRow {
  id: string;
  name: string;
  enabled: boolean;
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

interface MarketEntry {
  name: string;
  title: string;
  description: string;
  version: string;
  installLabel: string;
}

@Component
export struct PluginsPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('pluginBundles') bundles: PluginItem[] = [];
  @StorageLink('pluginOfficialItems') officialItems: OfficialPluginItem[] = [];
  @StorageLink('pluginManagementAvailable') managementAvailable: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @Consume('pageStack') pageStack: NavPathStack;
  @State pluginTab: string = 'installed';
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
  @State detailError: string = '';
  @State detailUpdateAvailable: boolean = false;
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
      })
      Row() {
        Image($r('app.media.ic_dir_chevron_mist'))
          .width(10)
          .height(10)
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
        .fontSize(15)
        .fontColor(this.textColor())
        .placeholderColor(this.subColor())
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
        .borderRadius(10)
        .height(44)
        .margin({ left: 18, right: 18 })
        .onChange((value: string) => {
          this.addSpec = value;
        })

      Row({ space: 8 }) {
        Text('安装源').fontSize(14).fontColor(this.textColor())
        Blank()
        Text(this.addRegistryMode === 'host' ? '跟随主机配置' : '自定义地址')
          .fontSize(13)
          .fontColor(this.accent())
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .backgroundColor(this.isDark ? 'rgba(46,107,230,0.18)' : 'rgba(46,107,230,0.10)')
          .borderRadius(6)
          .onClick(() => {
            this.addRegistryMode = this.addRegistryMode === 'host' ? 'custom' : 'host';
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 14 })

      if (this.addRegistryMode === 'custom') {
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

      Text('请确认插件来源可信。插件将在所连接的 DSH 主机以你的权限运行，可能读取、修改或泄露数据。')
        .fontSize(11)
        .fontColor(this.subColor())
        .width('100%')
        .padding({ left: 18, right: 18, top: 12 })

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
        Text('完成')
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
            this.addSheetOpen = false;
          })
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
          if (this.detailVersion.length > 0) {
            Text('v' + this.detailVersion).fontSize(12).fontColor(this.subColor())
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
              Text('包含的组件 · 共 ' + this.detailEntries.length + ' 个')
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.subColor())
              ForEach(this.detailEntries, (entry: EntryRow) => {
                Row() {
                  Text(entry.name).fontSize(14).fontColor(this.textColor()).layoutWeight(1)
                  Toggle({ type: ToggleType.Switch, isOn: entry.enabled })
                    .selectedColor(this.accent())
                    .scale({ x: 0.65, y: 0.65 })
                    .onChange((isOn: boolean) => {
                      this.toggleEntry(entry, isOn);
                    })
                }
                .width('100%')
                .padding({ left: 12, right: 8, top: 5, bottom: 5 })
                .borderRadius(10)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
              }, (entry: EntryRow) => entry.id)
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
        Image($r('app.media.plugin_art_plugin_default')).width(34).height(34).objectFit(ImageFit.Contain)
        Column({ space: 3 }) {
          Text(item.title.length > 0 ? item.title : item.name)
            .fontSize(15)
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
            Text('v' + item.version).fontSize(11).fontColor(this.subColor())
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text(item.installLabel.length > 0 ? item.installLabel : '安装')
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .height(30)
          .padding({ left: 14, right: 14 })
          .textAlign(TextAlign.Center)
          .borderRadius(8)
          .backgroundColor(this.accent())
          .onClick(() => {
            this.installMarketEntry(item);
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 11, bottom: 11 })
      .alignItems(VerticalAlign.Center)
      if (!last) {
        Row().width('100%').height(0.5).backgroundColor(this.dividerColor()).margin({ left: 62 })
      }
    }
    .width('100%')
  }

  @Builder
  marketBody() {
    Column() {
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
          Row({ space: 8 }) {
            if (this.marketSourceOpen) {
              TextInput({ text: this.marketSourceInput, placeholder: 'https://example.com/index.json' })
                .fontSize(13)
                .fontColor(this.textColor())
                .placeholderColor(this.subColor())
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                .borderRadius(8)
                .height(38)
                .layoutWeight(1)
                .onChange((value: string) => {
                  this.marketSourceInput = value;
                })
              Text('添加')
                .fontSize(13)
                .fontColor('#FFFFFF')
                .height(38)
                .padding({ left: 12, right: 12 })
                .textAlign(TextAlign.Center)
                .borderRadius(8)
                .backgroundColor(this.accent())
                .onClick(() => {
                  this.addMarketSource();
                })
            } else {
              Text('＋ 添加索引源')
                .fontSize(13)
                .fontColor(this.accent())
                .height(38)
                .padding({ left: 14, right: 14 })
                .textAlign(TextAlign.Center)
                .borderRadius(8)
                .backgroundColor(this.isDark ? 'rgba(46,107,230,0.18)' : 'rgba(46,107,230,0.10)')
                .onClick(() => {
                  this.marketSourceOpen = true;
                })
            }
          }
          .width('100%')
          .padding({ left: 24, right: 24 })
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
            this.marketSelected = '';
            this.marketLabel = '';
            this.marketEntries = [];
            this.loadMarketIndexes();
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

        if (this.marketEntries.length > 0) {
          Column() {
            ForEach(this.marketEntries, (item: MarketEntry, index: number) => {
              this.marketEntryRow(item, index === this.marketEntries.length - 1)
            }, (item: MarketEntry) => item.name)
          }
          .width('calc(100% - 32vp)')
          .margin({ left: 16, right: 16 })
          .backgroundColor(this.cardBg())
          .borderRadius(14)
          .clip(true)
        } else if (!this.marketLoading) {
          Text(this.marketQuery.length > 0 ? '没有符合条件的插件' : '此索引没有插件')
            .fontSize(12)
            .fontColor(this.subColor())
            .width('100%')
            .textAlign(TextAlign.Center)
            .padding({ top: 32, bottom: 32 })
        }
      }
    }
    .width('100%')
  }

  build() {
    NavDestination() {
      Column() {
        // ── 头部：圆形返回 + 居中标题（对齐 .plugins-header） ──
        Stack({ alignContent: Alignment.Center }) {
          Text(this.showingMore ? '实验性插件' : '插件')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Row() {
            NavBackButton({ isDark: this.isDark })
              .onClick(() => {
                if (this.showingMore) {
                  this.showingMore = false;
                } else {
                  this.pageStack.pop();
                }
              })
            Blank()
          }
          .width('100%')
          .padding({ left: 16, right: 16 })
        }
        .width('100%')
        .height(44)
        .padding({ top: 0 })
        .margin({ top: (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 4 })

        Scroll() {
          Column({ space: 20 }) {
            if (!this.showingMore) {
              Row({ space: 8 }) {
                Text('安装、启用和配置插件').fontSize(11).fontColor(this.subColor()).layoutWeight(1)
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
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
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
      for (const raw of this.arrField(rec, 'indexes')) {
        const item: Record<string, Object> = this.asRecord(raw);
        const url: string = this.strField(item, 'url');
        if (url.length > 0) {
          list.push({ label: this.strField(item, 'label'), url: url, error: this.strField(item, 'error') });
        }
      }
      for (const raw of this.arrField(rec, 'sources')) {
        const item: Record<string, Object> = this.asRecord(raw);
        const url: string = this.strField(item, 'url');
        if (url.length > 0 && list.filter((x: MarketIndex) => x.url === url).length === 0) {
          list.push({ label: this.strField(item, 'label'), url: url, error: this.strField(item, 'error') });
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
    GatewayClient.get().searchMarket(this.marketSelected, this.marketQuery.trim(), '', cursor, 30).then((frame) => {
      const rec: Record<string, Object> = this.asRecord(frame);
      const entries: MarketEntry[] = [];
      for (const raw of this.arrField(rec, 'entries')) {
        const item: Record<string, Object> = this.asRecord(raw);
        const name: string = this.strField(item, 'name');
        if (name.length > 0) {
          entries.push({
            name: name,
            title: this.strField(item, 'title'),
            description: this.strField(item, 'description'),
            version: this.strField(item, 'version'),
            installLabel: this.strField(item, 'installLabel')
          });
        }
      }
      this.marketEntries = entries;
      this.marketNext = this.strField(rec, 'next');
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
    const indexes: Record<string, Object>[] = [];
    for (const item of this.marketIndexes) {
      indexes.push({ 'url': item.url, 'label': item.label });
    }
    indexes.push({ 'url': url, 'label': url });
    GatewayClient.get().setMarketIndexes(indexes as Object[]).then(() => {
      this.marketSourceOpen = false;
      this.marketSourceInput = '';
      this.loadMarketIndexes();
    }).catch((err: Error) => {
      this.marketError = err.message;
    });
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
    const registry: string | null = this.addRegistryMode === 'custom' && this.addRegistryUrl.trim().length > 0
      ? this.addRegistryUrl.trim() : null;
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

  private buildFields(kind: string, ns: string, namespace: PluginNamespace): PluginField[] {
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
    const updated: EntryRow = { id: entry.id, name: entry.name, enabled: enabled };
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
    this.detailEntries = [];
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
      const entries: EntryRow[] = [];
      for (const raw of this.arrField(rec, 'items')) {
        const entry: Record<string, Object> = this.asRecord(raw);
        const id: string = this.strField(entry, 'entryId') || this.strField(entry, 'id');
        const name: string = this.strField(entry, 'name') || id;
        if (id.length > 0) {
          entries.push({ id: id, name: name, enabled: this.readBool(entry, 'enabled') });
        }
      }
      this.detailEntries = entries;
    }).catch((err: Error) => {
      this.detailBusy = false;
      this.detailError = err.message;
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
