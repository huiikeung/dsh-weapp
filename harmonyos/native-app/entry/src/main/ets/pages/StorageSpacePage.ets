import { common } from '@kit.AbilityKit';
import { currentGlassLevel, currentGlassMaterialLevel } from '../common/GlassMaterial';
import { fileIo } from '@kit.CoreFileKit';
import { AttachmentCache, AttachmentImageCache, PreferencesStore, SessionStore, SessionSummary } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';
import { HdsNavDestination, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

/** 存储空间分类（对齐小程序 storage-usage CATEGORIES） */
interface StorageCategoryItem {
  key: string;
  title: string;
  detail: string;
  color: string;
  icon: Resource;
  bytes: number;
  bytesText: string;
}


/**
 * 存储空间（设置 → 存储空间）：iOS 分组卡片风格的二级页面。
 * 列表页：环形图 + 本机缓存总量 + 四类缓存行；点分类进入详情页可单独清理。
 * 对齐小程序 pages/settings 的 StorageSpaceView（四类：聊天记录 / 图片 / 文件预览 / 临时文件）。
 */
@Component
export struct StorageSpacePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @State loading: boolean = true;
  @State busy: boolean = false;
  @State detailKey: string = '';
  @State chatsBytes: number = 0;
  @State imagesBytes: number = 0;
  @State filesBytes: number = 0;
  @State tempBytes: number = 0;
  @State hint: string = '';

  aboutToAppear(): void {
    this.refresh();
  }

  // ── 主题 ──
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
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  // ── 数据 ──
  private storageDir(context: common.UIAbilityContext): string {
    return context.filesDir + '/dsh-downloads';
  }

  private totalBytes(): number {
    return this.chatsBytes + this.imagesBytes + this.filesBytes + this.tempBytes;
  }

  private bytesLabel(bytes: number): string {
    if (!bytes || bytes < 0) {
      return '0 KB';
    }
    if (bytes < 1024) {
      return bytes.toString() + ' B';
    }
    const kb: number = bytes / 1024;
    if (kb < 1024) {
      const value: number = kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10;
      return value.toString() + ' KB';
    }
    const mb: number = kb / 1024;
    if (mb < 1024) {
      const value: number = mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10;
      return value.toString() + ' MB';
    }
    const gb: number = Math.round(mb / 102.4) / 10;
    return gb.toString() + ' GB';
  }

  private category(key: string, title: string, detail: string, color: string, icon: Resource,
    bytes: number): StorageCategoryItem {
    return {
      key: key, title: title, detail: detail, color: color, icon: icon,
      bytes: bytes, bytesText: this.bytesLabel(bytes)
    };
  }

  private categories(): StorageCategoryItem[] {
    const items: StorageCategoryItem[] = [];
    items.push(this.category('chats', '聊天记录', '会话列表与正文缓存', '#3D7AC7',
      $r('app.media.cmd_session'), this.chatsBytes));
    items.push(this.category('images', '图片', '聊天中下载的图片', '#3BA38C',
      $r('app.media.deliverable_image'), this.imagesBytes));
    items.push(this.category('files', '文件预览', '会话中下载的文件', '#DBA347',
      $r('app.media.attach_file'), this.filesBytes));
    items.push(this.category('temporary', '临时文件', '未完成的下载与临时副本', '#A182C2',
      $r('app.media.menu_ic_folder'), this.tempBytes));
    return items;
  }

  private detailItem(): StorageCategoryItem | undefined {
    if (this.detailKey.length === 0) {
      return undefined;
    }
    for (const item of this.categories()) {
      if (item.key === this.detailKey) {
        return item;
      }
    }
    return undefined;
  }

  private detailTitle(): string {
    const item: StorageCategoryItem | undefined = this.detailItem();
    return item === undefined ? '存储空间' : item.title;
  }

  private detailIcon(): Resource {
    const item: StorageCategoryItem | undefined = this.detailItem();
    return item === undefined ? $r('app.media.menu_ic_folder') : item.icon;
  }

  private detailColor(): string {
    const item: StorageCategoryItem | undefined = this.detailItem();
    return item === undefined ? '#3D7AC7' : item.color;
  }

  private detailDesc(): string {
    const item: StorageCategoryItem | undefined = this.detailItem();
    return item === undefined ? '' : item.detail;
  }

  private detailBytesText(): string {
    const item: StorageCategoryItem | undefined = this.detailItem();
    return item === undefined ? '0 KB' : item.bytesText;
  }

  // ── 统计 / 清理 ──
  private async temporaryBytes(context: common.UIAbilityContext): Promise<number> {
    const root: string = this.storageDir(context);
    try {
      const names: string[] = await fileIo.listFile(root);
      let total: number = 0;
      for (const name of names) {
        if (!name.endsWith('.part')) {
          continue;
        }
        try {
          total += (await fileIo.stat(root + '/' + name)).size;
        } catch (err) {
        }
      }
      return total;
    } catch (err) {
      return 0;
    }
  }

  private async clearTemporaryFiles(context: common.UIAbilityContext): Promise<number> {
    const root: string = this.storageDir(context);
    let freed: number = 0;
    try {
      const names: string[] = await fileIo.listFile(root);
      for (const name of names) {
        if (!name.endsWith('.part')) {
          continue;
        }
        const path: string = root + '/' + name;
        try {
          freed += (await fileIo.stat(path)).size;
          await fileIo.unlink(path);
        } catch (err) {
        }
      }
    } catch (err) {
      return freed;
    }
    return freed;
  }

  private async refresh(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    this.loading = true;
    let chats: number = 0;
    try {
      chats = PreferencesStore.get().localCacheBytes(['cacheSessionsV1', 'cacheWorkspacesV1', 'draft:']);
    } catch (err) {
      chats = 0;
    }
    let images: number = 0;
    try {
      images = AttachmentImageCache.bytes();
    } catch (err) {
      images = 0;
    }
    let files: number = 0;
    try {
      files = await AttachmentCache.bytes(context);
    } catch (err) {
      files = 0;
    }
    const temporary: number = await this.temporaryBytes(context);
    this.chatsBytes = chats;
    this.imagesBytes = images;
    this.filesBytes = files;
    this.tempBytes = temporary;
    this.loading = false;
  }

  private async clearCategory(): Promise<void> {
    if (this.busy || this.detailKey.length === 0) {
      return;
    }
    this.busy = true;
    const context = getContext(this) as common.UIAbilityContext;
    const key: string = this.detailKey;
    let freed: number = 0;
    try {
      if (key === 'chats') {
        freed = this.chatsBytes;
        PreferencesStore.get().removeLocalCacheByPrefixes(['cacheSessionsV1', 'cacheWorkspacesV1', 'draft:']);
        SessionStore.get().clear();
        AppStorage.setOrCreate<SessionSummary[]>('sessions', []);
        AppStorage.setOrCreate<Object[]>('dirEntries', []);
        AppStorage.setOrCreate<Object[]>('queueItems', []);
        AppStorage.setOrCreate<number>('queueCount', 0);
        AppStorage.setOrCreate<number>('sessionRowCount', 0);
      } else if (key === 'images') {
        freed = AttachmentImageCache.clear();
      } else if (key === 'files') {
        freed = await AttachmentCache.clear(context);
      } else if (key === 'temporary') {
        freed = await this.clearTemporaryFiles(context);
      }
      this.hint = freed > 0 ? ('已清理 ' + this.bytesLabel(freed)) : '没有可清理的缓存';
      await this.refresh();
    } catch (err) {
      this.hint = '清理失败，请重试';
    }
    this.busy = false;
  }

  /** 有占用的分类（分段条只画非零段） */
  private activeCategories(): StorageCategoryItem[] {
    const out: StorageCategoryItem[] = [];
    for (const item of this.categories()) {
      if (item.bytes > 0) {
        out.push(item);
      }
    }
    return out;
  }

  // ── UI（对齐 iOS 设置 → 通用 → iPhone 储存空间）──

  /** iOS 分组标题 */
  @Builder
  groupTitle(title: string) {
    Text(title)
      .fontSize(13)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 2, right: 2, top: 18, bottom: 7 })
  }

  /** iOS 分组 footer 说明 */
  @Builder
  groupFooter(text: string) {
    Text(text)
      .fontSize(12)
      .lineHeight(18)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 2, right: 2, top: 8 })
  }

  /**
   * 占比分段条（iOS 储存空间顶部那条）：按各类字节量 layoutWeight 分宽，
   * 段间 2vp 缝、整条圆角裁切；没有占用时显示轨道色。
   */
  @Builder
  segmentBar() {
    Row({ space: 2 }) {
      ForEach(this.activeCategories(), (item: StorageCategoryItem) => {
        Column()
          .height(14)
          .layoutWeight(item.bytes)
          .borderRadius(3)
          .backgroundColor(item.color)
      }, (item: StorageCategoryItem) => item.key)
    }
    .width('100%')
    .height(14)
    .borderRadius(7)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)')
    .clip(true)
  }

  /** 图例行：小色块 + 名称 + 大小（iOS 图例不带图标、不带百分比） */
  @Builder
  legendRow(item: StorageCategoryItem) {
    Row({ space: 12 }) {
      Column()
        .width(10)
        .height(10)
        .borderRadius(3)
        .backgroundColor(item.color)
      Text(item.title)
        .fontSize(15)
        .fontColor(this.textColor())
        .layoutWeight(1)
      Text(item.bytesText)
        .fontSize(15)
        .fontColor(this.subColor())
      Image($r('app.media.chev_right_gray'))
        .width(12)
        .height(12)
        .objectFit(ImageFit.Contain)
        .opacity(0.5)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .border({ width: { top: 0.5 }, color: this.dividerColor() })
    .onClick(() => {
      this.detailKey = item.key;
      this.hint = '';
    })
  }

  /** 顶部卡片：总量 + 分段条 + 图例 */
  @Builder
  heroCard() {
    Column() {
      Column({ space: 8 }) {
        Text('本机缓存')
          .fontSize(13)
          .fontColor(this.subColor())
          .width('100%')
        Text(this.bytesLabel(this.totalBytes()))
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .width('100%')
        this.segmentBar()
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 16, right: 16, top: 18, bottom: 18 })
      ForEach(this.categories(), (item: StorageCategoryItem) => {
        this.legendRow(item)
      }, (item: StorageCategoryItem) => item.key)
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .clip(true)
  }

  /** 详情头部：iOS 应用详情那种「饱和色大圆角图标 + 白色 glyph」，直接放在页面底色上 */
  @Builder
  detailHero() {
    Column({ space: 10 }) {
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(64)
          .height(64)
          .borderRadius(15)
          .backgroundColor(this.detailColor())
        Image(this.detailIcon())
          .width(32)
          .height(32)
          .objectFit(ImageFit.Contain)
          .fillColor(Color.White)
      }
      Text(this.detailTitle())
        .fontSize(20)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(this.detailBytesText())
        .fontSize(15)
        .fontColor(this.subColor())
      Text(this.detailDesc())
        .fontSize(13)
        .fontColor(this.subColor())
    }
    .width('100%')
    .padding({ top: 24, bottom: 12 })
    .alignItems(HorizontalAlign.Center)
  }

  /** 清理按钮（iOS 分组里的红色居中文字行） */
  @Builder
  detailActions() {
    Column() {
      Row() {
        Text(this.busy ? '清理中…' : '清理本机缓存')
          .fontSize(15)
          .fontColor('#FF3B30')
          .width('100%')
          .textAlign(TextAlign.Center)
      }
      .width('100%')
      .padding({ top: 14, bottom: 14 })
      .onClick(() => {
        this.clearCategory();
      })
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .opacity(this.busy ? 0.5 : 1)
  }
  private scroller: Scroller = new Scroller();

  build() {
    HdsNavDestination() {
      Column() {
        if (this.loading) {
          Column() {
            Text('正在统计…')
              .fontSize(14)
              .fontColor(this.subColor())
          }
          .width('100%')
          .layoutWeight(1)
          .justifyContent(FlexAlign.Center)
        } else {
          Scroll(this.scroller) {
            Column({ space: 0 }) {
              // 首屏让出原生标题栏
              Column().width('100%').height((this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 56)
              if (this.detailKey.length === 0) {
                this.heroCard()
                this.groupFooter('清理后需要时会重新下载；不会删除网关上的会话、工作区或设备上的原文件。')
              } else {
                this.detailHero()
                this.groupTitle('清理')
                this.detailActions()
                this.groupFooter('只清理本机缓存文件；聊天记录与网关数据不受影响。')
              }
              if (this.hint.length > 0) {
                Text(this.hint)
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, top: 10 })
              }
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 8, bottom: 30 })
          }
          .layoutWeight(1)
          .align(Alignment.Top)
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.None)
          // 平板/宽屏：设置内容居中一栏（对齐 iOS iPad 设置页）
          .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .titleBar({
      avoidLayoutSafeArea: true,
      content: { title: { mainTitle: '存储空间' } },
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
}
