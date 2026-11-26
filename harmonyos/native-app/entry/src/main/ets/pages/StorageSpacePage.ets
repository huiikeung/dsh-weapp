import { common } from '@kit.AbilityKit';
import { currentGlassLevel, currentGlassMaterialLevel } from '../common/GlassMaterial';
import { fileIo } from '@kit.CoreFileKit';
import { AttachmentCache, AttachmentImageCache, PreferencesStore, SessionStore, SessionSummary } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';
import { HdsNavDestination, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';
import { appGlassBlur, appGlassBorderColor, appGlassFill, appGlassShadow } from '../common/AppGlass';
import { immersiveSheetSupported, sheetFallbackColor, sheetSystemMaterial } from '../common/SheetMaterial';

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
 * 列表页：占比圆环（中心总量）+ 四类图例行；点分类弹出原生玻璃底部弹窗，可单独清理。
 * 对齐小程序 pages/settings 的 StorageSpaceView（四类：聊天记录 / 图片 / 文件预览 / 临时文件）。
 */
@Component
export struct StorageSpacePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') @Watch('onRingInputs') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('safeBottomVp') safeBottomStorage: number = 0;
  @State loading: boolean = true;
  @State busy: boolean = false;
  @State detailKey: string = '';
  /** 分类详情：原生沉浸玻璃底部弹窗 */
  @State sheetOpen: boolean = false;
  @State @Watch('onRingInputs') chatsBytes: number = 0;
  @State @Watch('onRingInputs') imagesBytes: number = 0;
  @State @Watch('onRingInputs') filesBytes: number = 0;
  @State @Watch('onRingInputs') tempBytes: number = 0;
  /** 图例排序：'size'（默认，按大小降序）/ 'name' */
  @State sortMode: string = 'size';
  /** 自绘圆环的画布上下文（DataPanel 画不出 0.3° 的小段，改自绘并给每段最小角度） */
  private ringCtx: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private ringReady: boolean = false;
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

  /** 圆环输入变化（主题 / 字节量）：画布就绪后重画 */
  onRingInputs(): void {
    this.drawRing();
  }

  /**
   * 画占比圆环：轨道圆 + 各分类弧段。
   * 每个非零分类先保证 minA（~8°）的最小角度，剩余角度再按字节量比例分配，
   * 这样 232 KB / 94 KB 的小段也能看见；段间留 gap（~1.7°）细缝。
   */
  private drawRing(): void {
    if (!this.ringReady) {
      return;
    }
    const ctx: CanvasRenderingContext2D = this.ringCtx;
    const size: number = 168;
    const stroke: number = 14;
    const c: number = size / 2;
    const radius: number = (size - stroke) / 2;
    const tau: number = Math.PI * 2;
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = 'butt';
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, tau);
    ctx.strokeStyle = this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)';
    ctx.stroke();
    const items: StorageCategoryItem[] = [];
    let total: number = 0;
    for (const item of this.categories()) {
      if (item.bytes > 0) {
        items.push(item);
        total += item.bytes;
      }
    }
    const n: number = items.length;
    if (n === 0 || total <= 0) {
      return;
    }
    const gap: number = n > 1 ? 0.03 : 0;
    let minA: number = 0.14;
    if (n * minA + n * gap > tau) {
      minA = (tau - n * gap) / n;
    }
    const spare: number = tau - n * gap - n * minA;
    let start: number = -Math.PI / 2;
    for (const item of items) {
      const angle: number = minA + spare * (item.bytes / total);
      ctx.beginPath();
      ctx.arc(c, c, radius, start, start + angle);
      ctx.strokeStyle = item.color;
      ctx.stroke();
      start += angle + gap;
    }
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
    this.drawRing();
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

  // ── UI（对齐 iOS 设置 → 通用 → iPhone 储存空间）──

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

  /** 排序后的分类（图例用；默认按大小降序，与 iOS 储存列表一致） */
  private sortedCategories(): StorageCategoryItem[] {
    const items: StorageCategoryItem[] = this.categories();
    if (this.sortMode === 'name') {
      items.sort((a: StorageCategoryItem, b: StorageCategoryItem): number => a.title.localeCompare(b.title));
    } else {
      items.sort((a: StorageCategoryItem, b: StorageCategoryItem): number => b.bytes - a.bytes);
    }
    return items;
  }

  /** 排序菜单（系统 Menu：按大小 / 按名称，当前项带 ✓） */
  @Builder
  sortMenu() {
    Column() {
      this.sortMenuItem('按大小', 'size')
      this.sortMenuItem('按名称', 'name')
    }
  }

  @Builder
  sortMenuItem(label: string, mode: string) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.textColor())
      Blank()
      if (this.sortMode === mode) {
        SymbolGlyph($r('sys.symbol.checkmark'))
          .fontSize(14)
          .fontColor([this.textColor()])
      }
    }
    .width(150)
    .height(44)
    .padding({ left: 14, right: 14 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.sortMode = mode;
    })
  }

  /** 右上角排序胶囊（与弹窗「关闭」同一套玻璃样式） */
  @Builder
  sortPill() {
    Row({ space: 4 }) {
      Text(this.sortMode === 'size' ? '按大小' : '按名称')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      SymbolGlyph($r('sys.symbol.chevron_down'))
        .fontSize(11)
        .fontColor([this.textColor()])
    }
    .height(30)
    .padding({ left: 12, right: 10 })
    .alignItems(VerticalAlign.Center)
    .backgroundColor(appGlassFill(this.isDark))
    .backdropBlur(appGlassBlur(this.isDark))
    .clip(true)
    .borderRadius(15)
    .border({ width: 1, color: appGlassBorderColor(this.isDark) })
    .shadow(appGlassShadow(this.isDark))
    .bindMenu(this.sortMenu())
  }

  /** 图例卡上方的分组标题行：左「缓存分类」、右排序胶囊 */
  @Builder
  legendHeader() {
    Row() {
      Text('缓存分类')
        .fontSize(13)
        .fontColor(this.subColor())
      Blank()
      this.sortPill()
    }
    .width('100%')
    .padding({ left: 2, right: 2, top: 18, bottom: 7 })
    .alignItems(VerticalAlign.Center)
  }

  /**
   * 占比圆环（自绘 Canvas）：每个非零分类至少占 ~8°，再按字节量分剩余角度 ——
   * 232 KB 这种 0.3° 的段用 DataPanel 画出来是看不见的；中心叠「总量 / 本机缓存」。
   */
  @Builder
  usageRing() {
    Stack({ alignContent: Alignment.Center }) {
      Canvas(this.ringCtx)
        .width(168)
        .height(168)
        .onReady(() => {
          this.ringReady = true;
          this.drawRing();
        })
      Column({ space: 2 }) {
        Text(this.bytesLabel(this.totalBytes()))
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text('本机缓存')
          .fontSize(12)
          .fontColor(this.subColor())
      }
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .padding({ top: 16, bottom: 16 })
  }

  /** 图例行：小色块 + 名称 + 大小（iOS 图例不带图标、不带百分比） */
  @Builder
  legendRow(item: StorageCategoryItem, index: number) {
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
    .border({ width: { top: index > 0 ? 0.5 : 0 }, color: this.dividerColor() })
    .onClick(() => {
      this.detailKey = item.key;
      this.hint = '';
      this.sheetOpen = true;
    })
  }

  /** 卡片一：圆环（与图例拆成两个分组，对齐 iOS） */
  @Builder
  ringCard() {
    Column() {
      this.usageRing()
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .clip(true)
  }

  /** 卡片二：图例（按 sortMode 排序） */
  @Builder
  legendCard() {
    Column() {
      ForEach(this.sortedCategories(), (item: StorageCategoryItem, index: number) => {
        this.legendRow(item, index)
      }, (item: StorageCategoryItem) => item.key)
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .clip(true)
  }
  /**
   * 分类详情：原生沉浸玻璃底部弹窗（与首页「定时任务」同一套：拖动条 + 标题行 + 玻璃「关闭」胶囊），
   * 内容 = 饱和色大图标 + 大小 + 说明 + 红色清理行 + 底部说明。
   */
  @Builder
  detailSheet() {
    Column() {
      // 拖动条（36×4）
      Row() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(216,210,225,0.35)' : 'rgba(92,83,108,0.30)')
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 6, bottom: 8 })

      // 标题 + 右上角「关闭」
      Row() {
        Text(this.detailTitle())
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Blank()
        Row() {
          Text('关闭')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
        }
        .height(30)
        .padding({ left: 14, right: 14 })
        .justifyContent(FlexAlign.Center)
        .backgroundColor(appGlassFill(this.isDark))
        .backdropBlur(appGlassBlur(this.isDark))
        .clip(true)
        .borderRadius(15)
        .border({ width: 1, color: appGlassBorderColor(this.isDark) })
        .shadow(appGlassShadow(this.isDark))
        .onClick(() => {
          this.sheetOpen = false;
        })
      }
      .width('100%')
      .height(44)
      .alignItems(VerticalAlign.Center)

      // 图标 + 大小 + 说明
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
        Text(this.detailBytesText())
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
        Text(this.detailDesc())
          .fontSize(13)
          .fontColor(this.subColor())
      }
      .width('100%')
      .padding({ top: 18, bottom: 22 })
      .alignItems(HorizontalAlign.Center)

      // 清理（iOS 分组里的红色居中文字行；玻璃底上用一层淡白卡托住）
      Row() {
        Text(this.busy ? '清理中…' : '清理本机缓存')
          .fontSize(15)
          .fontColor('#FF3B30')
          .width('100%')
          .textAlign(TextAlign.Center)
      }
      .width('100%')
      .padding({ top: 14, bottom: 14 })
      .borderRadius(16)
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)')
      .border({ width: 1, color: this.dividerColor() })
      .opacity(this.busy ? 0.5 : 1)
      .onClick(() => {
        this.clearCategory();
      })

      if (this.hint.length > 0) {
        Text(this.hint)
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
          .textAlign(TextAlign.Center)
          .margin({ top: 12 })
      }
      Text('只清理本机缓存文件；聊天记录与网关数据不受影响。')
        .fontSize(12)
        .lineHeight(18)
        .fontColor(this.subColor())
        .width('100%')
        .textAlign(TextAlign.Center)
        .margin({ top: 12 })
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 6, bottom: 16 + this.safeBottomStorage })
    // 面板交给系统沉浸玻璃材质绘制（见 build() 的 bindSheet），这里只排内容
    .backgroundColor(Color.Transparent)
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
              this.ringCard()
              this.legendHeader()
              this.legendCard()
              this.groupFooter('清理后需要时会重新下载；不会删除网关上的会话、工作区或设备上的原文件。')
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
      // 分类详情：原生沉浸玻璃底部弹窗（系统返回手势会先关弹窗，不会直接退出页面）
      .bindSheet($$this.sheetOpen, this.detailSheet(), {
        height: SheetSize.FIT_CONTENT,
        dragBar: false,
        showClose: false,
        preferType: SheetType.BOTTOM,
        backgroundColor: immersiveSheetSupported() ? Color.Transparent : sheetFallbackColor(this.isDark),
        systemMaterial: sheetSystemMaterial(this.isDark)
      })
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
