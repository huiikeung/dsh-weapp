import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { AttachmentCache, AttachmentImageCache, PreferencesStore, SessionStore, SessionSummary } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';

/** 存储空间分类（对齐小程序 storage-usage CATEGORIES） */
interface StorageCategoryItem {
  key: string;
  title: string;
  detail: string;
  color: string;
  icon: Resource;
  bytes: number;
  bytesText: string;
  pctText: string;
}

/** iOS 风格图标白描边矩阵（彩色底上的白色 glyph） */
const WHITE_TINT: number[] = [
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0
];

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
    bytes: number, total: number): StorageCategoryItem {
    const pctText: string = (total > 0 && bytes > 0) ? Math.round(bytes * 100 / total).toString() + '%' : '';
    return {
      key: key, title: title, detail: detail, color: color, icon: icon,
      bytes: bytes, bytesText: this.bytesLabel(bytes), pctText: pctText
    };
  }

  private categories(): StorageCategoryItem[] {
    const total: number = this.totalBytes();
    const items: StorageCategoryItem[] = [];
    items.push(this.category('chats', '聊天记录', '会话列表与正文缓存', '#3D7AC7',
      $r('app.media.cmd_session'), this.chatsBytes, total));
    items.push(this.category('images', '图片', '聊天中下载的图片', '#3BA38C',
      $r('app.media.deliverable_image'), this.imagesBytes, total));
    items.push(this.category('files', '文件预览', '会话中下载的文件', '#DBA347',
      $r('app.media.attach_file'), this.filesBytes, total));
    items.push(this.category('temporary', '临时文件', '未完成的下载与临时副本', '#A182C2',
      $r('app.media.menu_ic_folder'), this.tempBytes, total));
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

  // ── UI ──
  @Builder
  navBar() {
    Row() {
      NavBackButton({ isDark: this.isDark })
        .onClick(() => {
          if (this.busy) {
            return;
          }
          if (this.detailKey.length > 0) {
            this.detailKey = '';
          } else {
            this.pageStack.pop();
          }
        })
      Text(this.detailKey.length > 0 ? this.detailTitle() : '存储空间')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Row().width(44).height(44)
    }
    .width('100%')
    .height(56)
    .padding({ left: 16, right: 16 })
    .margin({ top: this.topInset() })
  }

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

  /** 彩色图标块（iOS settings 风格：圆角方块 + 白色 glyph） */
  @Builder
  categoryIcon(color: string, icon: Resource, size: number, radius: number) {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(size)
        .height(size)
        .borderRadius(radius)
        .linearGradient({
          angle: 180,
          colors: [[color, 0], [color + 'C4', 1]]
        })
      Image(icon)
        .width(size * 0.52)
        .height(size * 0.52)
        .objectFit(ImageFit.Contain)
        .colorFilter(WHITE_TINT)
    }
  }

  @Builder
  heroCard() {
    Column({ space: 0 }) {
      Stack({ alignContent: Alignment.Center }) {
        DataPanel({
          values: [this.chatsBytes, this.imagesBytes, this.filesBytes, this.tempBytes],
          max: this.totalBytes() > 0 ? this.totalBytes() : 1,
          type: DataPanelType.Circle
        })
          .valueColors(['#3D7AC7', '#3BA38C', '#DBA347', '#A182C2'])
          .trackBackgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)')
          .strokeWidth(16)
          .width(168)
          .height(168)
        Column({ space: 2 }) {
          Text(this.bytesLabel(this.totalBytes()))
            .fontSize(20)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Text('本机缓存')
            .fontSize(12)
            .fontColor(this.subColor())
        }
      }
      .width('100%')
      .height(200)
      Row() {
        Column({ space: 2 }) {
          Text('本地键值存储')
            .fontSize(14)
            .fontColor(this.textColor())
          Text('不含图片与文件')
            .fontSize(11.5)
            .fontColor(this.subColor())
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Text(this.bytesLabel(this.chatsBytes))
          .fontSize(13)
          .fontColor(this.subColor())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .border({ width: { top: 0.5 }, color: this.dividerColor() })
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .clip(true)
  }

  @Builder
  categoryList() {
    Column() {
      ForEach(this.categories(), (item: StorageCategoryItem, index: number) => {
        Row({ space: 12 }) {
          this.categoryIcon(item.color, item.icon, 30, 8)
          Column({ space: 1 }) {
            Text(item.title)
              .fontSize(15)
              .fontColor(this.textColor())
            Text(item.detail)
              .fontSize(12)
              .fontColor(this.subColor())
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Column({ space: 1 }) {
            Text(item.bytesText)
              .fontSize(13)
              .fontColor(this.subColor())
            if (item.pctText.length > 0) {
              Text(item.pctText)
                .fontSize(11)
                .fontColor(this.subColor())
            }
          }
          .alignItems(HorizontalAlign.End)
          Image($r('app.media.chev_right_gray'))
            .width(12)
            .height(12)
            .objectFit(ImageFit.Contain)
            .opacity(0.5)
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 13, bottom: 13 })
        .border({ width: { top: index > 0 ? 0.5 : 0 }, color: this.dividerColor() })
        .onClick(() => {
          this.detailKey = item.key;
          this.hint = '';
        })
      }, (item: StorageCategoryItem) => item.key)
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .clip(true)
  }

  @Builder
  detailHero() {
    Column({ space: 12 }) {
      this.categoryIcon(this.detailColor(), this.detailIcon(), 56, 14)
      Text(this.detailTitle())
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(this.detailDesc())
        .fontSize(13)
        .fontColor(this.subColor())
      Text(this.detailBytesText())
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
    }
    .width('100%')
    .padding({ top: 24, bottom: 24 })
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .alignItems(HorizontalAlign.Center)
  }

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

  build() {
    NavDestination() {
      Column() {
        this.navBar()
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
          Scroll() {
            Column({ space: 0 }) {
              if (this.detailKey.length === 0) {
                this.heroCard()
                this.groupTitle('缓存分类')
                this.categoryList()
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
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
