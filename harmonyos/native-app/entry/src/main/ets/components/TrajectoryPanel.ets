/**
 * 轨迹面板（对齐小程序 styles/trajectory.wxss + preview/trajectory 的成品样式）：
 *   · 顶部时间概览：时长 / 轮次 / 调用 + 三条时间轴（输入=蓝 / 模型=紫 / 工具=橙）+ 起止轴
 *   · 轮次分隔：全宽发丝线 +「第 N 轮」小标签
 *   · 事件行（40vp）：彩色徽标（用户/助手/工具/上下文）+ 名称 + 预览 + #seq + chevron
 *   · 点行打开详情抽屉（类型 / 序号 / 时间 / 轮次 / 完整预览）
 * 数据来自 EventProjector 写入的 traceRows / traceOverview（只读）。
 */
import { uiMaterial } from '@kit.ArkUI';
import type { TraceRow, TraceBand, TraceOverview } from 'nativecore';

interface LanePart {
  gap: number;
  width: number;
  error: boolean;
}

interface TraceDisplayRow {
  row: TraceRow;
  turnLabel: string;
}

interface TraceField {
  label: string;
  value: string;
}

interface TraceBlock {
  title: string;
  text: string;
}

interface TraceTurnSummary {
  turn: number;
  detail: string;
  range: string;
}

@Component
export struct TrajectoryPanel {
  @StorageLink('isDark') isDark: boolean = false;
  @Prop topInset: number = 110;
  @StorageProp('traceRows') rows: TraceRow[] = [];
  @StorageProp('traceOverview') overview: TraceOverview = {
    turns: 0, calls: 0, startAt: 0, endAt: 0, bands: []
  };
  @State private inspectorOpen: boolean = false;
  @State private inspectorKey: string = '';
  /** 详情面板当前页签：summary / preview / raw / input / output / timing */
  @State private inspectorTab: string = 'summary';
  /** 概览三个统计项的交互：时长=时间轴实际/等宽，轮次=按轮汇总视图，调用=只看工具调用 */
  @State private laneEqual: boolean = false;
  @State private viewMode: string = 'all';
  private inspectorScroller: Scroller = new Scroller();

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.62)';
  }

  private faintColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.38)' : 'rgba(16,19,24,0.38)';
  }

  private rowLineColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.06)';
  }

  private turnLineColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.04)';
  }

  private fillColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)';
  }

  private badgeColor(badge: string): string {
    if (badge === 'USER') {
      return '#2E6BE6';
    }
    if (badge === 'ASSISTANT') {
      return '#7A54C7';
    }
    if (badge === 'TOOL' || badge === 'SUBTOOL') {
      return '#F07D14';
    }
    if (badge === 'CONTEXT') {
      return '#40A66F';
    }
    return this.subColor();
  }

  private badgeTint(badge: string): string {
    if (badge === 'USER') {
      return this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.10)';
    }
    if (badge === 'ASSISTANT') {
      return this.isDark ? 'rgba(122,84,199,0.20)' : 'rgba(122,84,199,0.10)';
    }
    if (badge === 'TOOL' || badge === 'SUBTOOL') {
      return this.isDark ? 'rgba(240,125,20,0.18)' : 'rgba(240,125,20,0.10)';
    }
    if (badge === 'CONTEXT') {
      return this.isDark ? 'rgba(64,166,111,0.18)' : 'rgba(64,166,111,0.10)';
    }
    return this.fillColor();
  }

  /** 原生沉浸式玻璃是否可用（对齐对话页的文件差异弹窗） */
  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

  /** 系统玻璃材质：THICK + 极淡色彩，交给系统画「原生玻璃」背景 */
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

  private badgeLabel(badge: string): string {
    if (badge === 'USER') {
      return '用户';
    }
    if (badge === 'ASSISTANT') {
      return '助手';
    }
    if (badge === 'TOOL') {
      return '工具';
    }
    if (badge === 'SUBTOOL') {
      return '子工具';
    }
    if (badge === 'CONTEXT') {
      return '上下文';
    }
    return badge;
  }

  private barColor(kind: string, error: boolean): string {
    if (error) {
      return '#E5484D';
    }
    if (kind === 'input') {
      return '#2E6BE6';
    }
    if (kind === 'model') {
      return '#7A54C7';
    }
    return '#F07D14';
  }

  private spanMs(): number {
    const span: number = this.overview.endAt - this.overview.startAt;
    return span > 0 ? span : 1;
  }

  /** 把某一类时间轴段换算成「空隙 + 条形」宽度（按毫秒做权重） */
  private laneParts(kind: string): LanePart[] {
    const parts: LanePart[] = [];
    const span: number = this.spanMs();
    let cursor: number = this.overview.startAt;
    for (const band of this.overview.bands) {
      if (band.kind !== kind) {
        continue;
      }
      // 等宽操作模式：每段一样宽、只留一点空隙，便于逐段看清
      if (this.laneEqual) {
        parts.push({ gap: parts.length === 0 ? 0 : 0.3, width: 1, error: band.error });
        continue;
      }
      const start: number = band.start > 0 ? band.start : cursor;
      const gap: number = Math.max(0, start - cursor);
      const rawWidth: number = band.end > start ? band.end - start : 0;
      const width: number = Math.max(rawWidth, span / 90);
      parts.push({ gap: gap, width: width, error: band.error });
      cursor = start + width;
    }
    return parts;
  }

  private laneTail(kind: string): number {
    if (this.laneEqual) {
      return 0;
    }
    const span: number = this.spanMs();
    let cursor: number = this.overview.startAt;
    for (const band of this.overview.bands) {
      if (band.kind !== kind) {
        continue;
      }
      const start: number = band.start > 0 ? band.start : cursor;
      const rawWidth: number = band.end > start ? band.end - start : 0;
      cursor = start + Math.max(rawWidth, span / 90);
    }
    return Math.max(0, this.overview.endAt - cursor);
  }

  /** 轮次视图：每轮一条汇总（记录数 / 调用数 / 时间范围） */
  private turnSummaries(): TraceTurnSummary[] {
    const out: TraceTurnSummary[] = [];
    let currentTurn: number = -99999;
    let count: number = 0;
    let calls: number = 0;
    let startAt: number = 0;
    let endAt: number = 0;
    const flush = (): void => {
      if (count === 0) {
        return;
      }
      out.push({
        turn: currentTurn,
        detail: count.toString() + ' 条记录 · ' + calls.toString() + ' 调用',
        range: this.clockText(startAt) + ' – ' + this.clockText(endAt)
      });
    };
    for (const row of this.rows) {
      if (row.turn !== currentTurn) {
        flush();
        currentTurn = row.turn;
        count = 0;
        calls = 0;
        startAt = row.time;
        endAt = row.time;
      }
      count += 1;
      if (row.kind === 'tool') {
        calls += 1;
      }
      if (row.time > 0) {
        if (startAt <= 0 || row.time < startAt) {
          startAt = row.time;
        }
        if (row.time > endAt) {
          endAt = row.time;
        }
      }
    }
    flush();
    return out;
  }

  /** 调用视图：只保留工具调用行（仍按轮次分段） */
  private visibleRows(): TraceDisplayRow[] {
    if (this.viewMode !== 'calls') {
      return this.displayRows();
    }
    const out: TraceDisplayRow[] = [];
    let lastTurn: number = -99999;
    for (const row of this.rows) {
      if (row.kind !== 'tool') {
        continue;
      }
      if (row.turn !== lastTurn) {
        lastTurn = row.turn;
        out.push({
          row: row,
          turnLabel: '第 ' + (row.turn >= 0 ? row.turn.toString() : '?') + ' 轮'
        });
      } else {
        out.push({ row: row, turnLabel: '' });
      }
    }
    return out;
  }

  private durationLabel(): string {
    const span: number = this.overview.endAt - this.overview.startAt;
    if (span <= 0) {
      return '—';
    }
    if (span >= 60000) {
      return Math.floor(span / 60000).toString() + ' 分 ' + Math.round((span % 60000) / 1000).toString() + ' 秒';
    }
    return (Math.round(span / 10) / 100).toString() + ' 秒';
  }

  private seqLabel(seq: number): string {
    return '#' + seq.toString();
  }

  private timeLabel(ms: number): string {
    if (ms <= 0) {
      return '—';
    }
    const date: Date = new Date(ms);
    const hh: string = date.getHours().toString().padStart(2, '0');
    const mm: string = date.getMinutes().toString().padStart(2, '0');
    const ss: string = date.getSeconds().toString().padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  /** 行列表：按轮次分组，插「第 N 轮」分隔标签 */
  private displayRows(): TraceDisplayRow[] {
    const out: TraceDisplayRow[] = [];
    let lastTurn: number = -99999;
    for (const row of this.rows) {
      if (row.turn !== lastTurn) {
        lastTurn = row.turn;
        out.push({ row: row, turnLabel: '第 ' + (row.turn >= 0 ? row.turn.toString() : '?') + ' 轮' });
      } else {
        out.push({ row: row, turnLabel: '' });
      }
    }
    return out;
  }

  private inspectorTabs(row: TraceRow): string[] {
    if (row.kind === 'tool') {
      return ['summary', 'input', 'output', 'timing'];
    }
    return ['summary', 'preview', 'raw'];
  }

  private tabLabel(id: string): string {
    if (id === 'summary') {
      return '摘要';
    }
    if (id === 'input') {
      return '参数';
    }
    if (id === 'output') {
      return '结果';
    }
    if (id === 'timing') {
      return '耗时';
    }
    if (id === 'preview') {
      return '预览';
    }
    return '原始';
  }

  private statusText(row: TraceRow): string {
    if (row.status === 'running') {
      return '运行中';
    }
    if (row.status === 'error') {
      return '失败';
    }
    return '已完成';
  }

  private clockText(ms: number): string {
    if (ms <= 0) {
      return '—';
    }
    const date: Date = new Date(ms);
    const hh: string = date.getHours().toString().padStart(2, '0');
    const mm: string = date.getMinutes().toString().padStart(2, '0');
    const ss: string = date.getSeconds().toString().padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  private durationText(row: TraceRow): string {
    if (row.startedAt <= 0 || row.endedAt < row.startedAt) {
      return '—';
    }
    const ms: number = row.endedAt - row.startedAt;
    if (ms >= 1000) {
      return (Math.round(ms / 100) / 10).toString() + ' 秒';
    }
    return ms.toString() + ' 毫秒';
  }

  private summaryFields(row: TraceRow): TraceField[] {
    const out: TraceField[] = [];
    out.push({ label: '来源', value: row.turn >= 0 ? ('第 ' + row.turn.toString() + ' 轮') : ('#' + row.seq.toString()) });
    out.push({ label: '状态', value: this.statusText(row) });
    out.push({ label: '序号', value: '#' + row.seq.toString() });
    return out;
  }

  private timingFields(row: TraceRow): TraceField[] {
    return [
      { label: '开始时间', value: this.clockText(row.startedAt) },
      { label: '结束时间', value: this.clockText(row.endedAt) },
      { label: '时长', value: this.durationText(row) }
    ];
  }

  private summaryBlocks(row: TraceRow): TraceBlock[] {
    const out: TraceBlock[] = [];
    if (row.kind === 'tool') {
      out.push({ title: '参数', text: row.args.length > 0 ? row.args : '（未捕获参数）' });
      out.push({
        title: '结果',
        text: row.result.length > 0 ? row.result
          : (row.status === 'running' ? '等待工具返回…' : '（未捕获结果）')
      });
    } else {
      if (row.thinking.length > 0) {
        out.push({ title: '思考', text: row.thinking });
      }
      out.push({ title: row.kind === 'assistant' ? '内容' : '预览', text: row.text.length > 0 ? row.text : '（无内容）' });
    }
    return out;
  }

  private previewBlocks(row: TraceRow): TraceBlock[] {
    return [{ title: row.kind === 'assistant' ? '内容' : '预览', text: row.text.length > 0 ? row.text : row.preview }];
  }

  private rawBlocks(row: TraceRow): TraceBlock[] {
    const out: TraceBlock[] = [];
    if (row.thinking.length > 0) {
      out.push({ title: '思考', text: row.thinking });
    }
    if (row.text.length > 0) {
      out.push({ title: '文本', text: row.text });
    }
    if (row.args.length > 0) {
      out.push({ title: '参数 JSON', text: row.args });
    }
    if (row.result.length > 0) {
      out.push({ title: '结果', text: row.result });
    }
    if (out.length === 0) {
      out.push({ title: '内容', text: row.preview.length > 0 ? row.preview : '（无内容）' });
    }
    return out;
  }

  private inspectorRow(): TraceRow | null {
    for (const row of this.rows) {
      if (row.key === this.inspectorKey) {
        return row;
      }
    }
    return null;
  }

  @Builder
  overviewCard() {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        // 时长：切换时间轴「实际时长 / 等宽」排布
        Text('时长 ' + this.durationLabel())
          .fontSize(11)
          .fontColor(this.laneEqual ? '#2E6BE6' : this.subColor())
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(6)
          .backgroundColor(this.laneEqual
            ? (this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
            : Color.Transparent)
          .onClick(() => {
            this.laneEqual = !this.laneEqual;
          })
        // 轮次：切到按轮汇总视图
        Text(this.overview.turns.toString() + ' 轮次')
          .fontSize(11)
          .fontColor(this.viewMode === 'turns' ? '#2E6BE6' : this.faintColor())
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(6)
          .backgroundColor(this.viewMode === 'turns'
            ? (this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
            : Color.Transparent)
          .onClick(() => {
            this.viewMode = this.viewMode === 'turns' ? 'all' : 'turns';
          })
        // 调用：只显示工具调用行
        Text(this.overview.calls.toString() + ' 调用')
          .fontSize(11)
          .fontColor(this.viewMode === 'calls' ? '#2E6BE6' : this.faintColor())
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(6)
          .backgroundColor(this.viewMode === 'calls'
            ? (this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
            : Color.Transparent)
          .onClick(() => {
            this.viewMode = this.viewMode === 'calls' ? 'all' : 'calls';
          })
        Blank()
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      this.lane('输入', 'input')
      this.lane('模型', 'model')
      this.lane('工具', 'tool')

      Row() {
        Text('0 秒')
          .fontSize(10)
          .fontColor(this.faintColor())
        Blank()
        Text(this.durationLabel())
          .fontSize(10)
          .fontColor(this.faintColor())
      }
      .width('100%')
      .padding({ left: 34 })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 10, bottom: 8 })
    .backgroundColor(this.fillColor())
  }

  @Builder
  lane(label: string, kind: string) {
    Row({ space: 7 }) {
      Text(label)
        .fontSize(10)
        .fontColor(this.faintColor())
        .width(28)
        .textAlign(TextAlign.End)
      Row() {
        ForEach(this.laneParts(kind), (part: LanePart, index: number) => {
          Blank()
            .layoutWeight(Math.max(part.gap, 0.0001))
          Row()
            .layoutWeight(Math.max(part.width, 0.0001))
            .height(8)
            .borderRadius(2)
            .backgroundColor(this.barColor(kind, part.error))
        }, (part: LanePart, index: number) => kind + index.toString())
        Blank()
          .layoutWeight(Math.max(this.laneTail(kind), 0.0001))
      }
      .layoutWeight(1)
      .height(18)
      .border({ width: { top: 0.5 }, color: this.rowLineColor() })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height(18)
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  turnDivider(label: string) {
    Row({ space: 6 }) {
      Text(label)
        .fontSize(9)
        .fontColor(this.faintColor())
      Blank()
    }
    .width('100%')
    .height(14)
    .padding({ left: 2 })
    .alignItems(VerticalAlign.Center)
    .border({ width: { top: 0.5 }, color: this.turnLineColor() })
  }

  @Builder
  traceRowLine(item: TraceDisplayRow) {
    Row({ space: 6 }) {
      Text(this.badgeLabel(item.row.badge))
        .fontSize(9)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.badgeColor(item.row.badge))
        .padding({ left: 5, right: 5, top: 2, bottom: 2 })
        .borderRadius(4)
        .backgroundColor(this.badgeTint(item.row.badge))
      Text(item.row.label)
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: '40%' })
      Text(item.row.preview.length > 0 ? item.row.preview : (this.badgeLabel(item.row.badge) === '工具' ? '（无参数）' : ''))
        .fontSize(12)
        .fontColor(this.faintColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text(this.seqLabel(item.row.seq))
        .fontSize(10)
        .fontFamily('monospace')
        .fontColor(this.faintColor())
      Image($r('app.media.chev_right_gray'))
        .width(12)
        .height(12)
        .objectFit(ImageFit.Contain)
        .opacity(0.5)
    }
    .width('100%')
    .height(40)
    .padding({ left: 10, right: 6 })
    .borderRadius(6)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.inspectorKey = item.row.key;
      this.inspectorTab = 'summary';
      this.inspectorOpen = true;
    })
  }

  @Builder
  inspectorSheet() {
    Column() {
      Column()
        .width(36)
        .height(4)
        .borderRadius(2)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.18)')
        .margin({ top: 10, bottom: 6 })
      if (this.inspectorRow() !== null) {
        Row({ space: 8 }) {
          // 头部用轨迹列表同款彩色徽标（不再是一个纯色圆点）
          Text(this.badgeLabel((this.inspectorRow() as TraceRow).badge))
            .fontSize(10)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.badgeColor((this.inspectorRow() as TraceRow).badge))
            .padding({ left: 6, right: 6, top: 2.5, bottom: 2.5 })
            .borderRadius(5)
            .backgroundColor(this.badgeTint((this.inspectorRow() as TraceRow).badge))
          Text((this.inspectorRow() as TraceRow).label)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text('关闭')
            .fontSize(13)
            .fontColor('#2E6BE6')
            .onClick(() => {
              this.inspectorOpen = false;
            })
        }
        .width('100%')
        .padding({ left: 20, right: 20, top: 4, bottom: 10 })
        .alignItems(VerticalAlign.Center)

        // 页签条：工具 = 摘要/参数/结果/耗时；消息 = 摘要/预览/原始（对齐小程序轨迹检查器）
        Row() {
          ForEach(this.inspectorTabs(this.inspectorRow() as TraceRow), (id: string) => {
            Column() {
              Text(this.tabLabel(id))
                .fontSize(13)
                .fontWeight(this.inspectorTab === id ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(this.inspectorTab === id ? '#2E6BE6' : this.faintColor())
              Row()
                .width(24)
                .height(2)
                .borderRadius(1)
                .backgroundColor(this.inspectorTab === id ? '#2E6BE6' : Color.Transparent)
                .margin({ top: 5 })
            }
            .layoutWeight(1)
            .padding({ top: 6, bottom: 0 })
            .onClick(() => {
              this.inspectorTab = id;
            })
          }, (id: string) => id)
        }
        .width('100%')
        .border({ width: { bottom: 0.5 }, color: this.rowLineColor() })

        Scroll() {
          Column({ space: 10 }) {
            if (this.inspectorTab === 'summary') {
              this.sheetFields(this.summaryFields(this.inspectorRow() as TraceRow))
              ForEach(this.summaryBlocks(this.inspectorRow() as TraceRow), (block: TraceBlock) => {
                this.sheetBlock(block)
              }, (block: TraceBlock) => block.title)
            } else if (this.inspectorTab === 'preview') {
              ForEach(this.previewBlocks(this.inspectorRow() as TraceRow), (block: TraceBlock) => {
                this.sheetBlock(block)
              }, (block: TraceBlock) => block.title)
            } else if (this.inspectorTab === 'raw') {
              ForEach(this.rawBlocks(this.inspectorRow() as TraceRow), (block: TraceBlock) => {
                this.sheetBlock(block)
              }, (block: TraceBlock) => block.title)
            } else if (this.inspectorTab === 'input') {
              this.sheetBlock({ title: '参数 JSON', text: (this.inspectorRow() as TraceRow).args.length > 0
                ? (this.inspectorRow() as TraceRow).args : '（未捕获参数）' })
            } else if (this.inspectorTab === 'output') {
              this.sheetBlock({ title: '结果', text: (this.inspectorRow() as TraceRow).result.length > 0
                ? (this.inspectorRow() as TraceRow).result
                : ((this.inspectorRow() as TraceRow).status === 'running' ? '等待工具返回…' : '（未捕获结果）') })
            } else if (this.inspectorTab === 'timing') {
              this.sheetFields(this.timingFields(this.inspectorRow() as TraceRow))
            }
          }
          .width('100%')
          .padding({ left: 20, right: 20, top: 14, bottom: 30 })
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .align(Alignment.TopStart)
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  sheetFields(fields: TraceField[]) {
    Column({ space: 8 }) {
      ForEach(fields, (item: TraceField) => {
        Row({ space: 12 }) {
          Text(item.label)
            .fontSize(12)
            .fontColor(this.faintColor())
            .width(76)
            .flexShrink(0)
          Text(item.value.length > 0 ? item.value : '—')
            .fontSize(13)
            .fontColor(this.textColor())
            .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
      }, (item: TraceField) => item.label)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  sheetBlock(block: TraceBlock) {
    Column({ space: 6 }) {
      Text(block.title)
        .fontSize(11)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.faintColor())
      Text(block.text)
        .fontSize(12.5)
        .lineHeight(19)
        .fontFamily('monospace')
        .fontColor(this.textColor())
        .width('100%')
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(12)
    .borderRadius(10)
    .backgroundColor(this.fillColor())
  }

  @Builder
  turnSummaryLine(item: TraceTurnSummary) {
    Row({ space: 8 }) {
      Text(item.turn >= 0 ? ('第 ' + item.turn.toString() + ' 轮') : '未分轮')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(item.detail)
        .fontSize(11)
        .fontColor(this.faintColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text(item.range)
        .fontSize(10)
        .fontColor(this.faintColor())
    }
    .width('100%')
    .height(44)
    .padding({ left: 10, right: 10 })
    .borderRadius(8)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.viewMode = 'all';
    })
  }

  @Builder
  emptyState() {
    Column({ space: 8 }) {
      Text('暂无轨迹数据')
        .fontSize(15)
        .fontColor(this.textColor())
      Text('连接网关并打开会话后，这里会按轮次显示工具调用与执行状态。')
        .fontSize(12)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ left: 40, right: 40, top: this.topInset })
  }

  build() {
    Column() {
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.inspectorOpen, this.inspectorSheet(), {
          height: '76%',
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          // 原生玻璃背景：可用时透明底 + systemMaterial 由系统绘制玻璃；不支持时退回纯色
          backgroundColor: this.immersiveSupported()
            ? Color.Transparent
            : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
          systemMaterial: this.sheetMaterial()
        })

      if (this.rows.length === 0) {
        this.emptyState()
      } else {
        // 顶部（导航栏 / 分页点所在的一段）铺成和概览卡同底色，避免顶部一截是页面底色、
        // 往下突然变成概览卡的灰底，接缝明显
        Row()
          .width('100%')
          .height(this.topInset)
          .backgroundColor(this.fillColor())
        this.overviewCard()
        if (this.viewMode === 'turns') {
          List({ space: 0, scroller: this.inspectorScroller }) {
            ForEach(this.turnSummaries(), (item: TraceTurnSummary) => {
              ListItem() {
                this.turnSummaryLine(item)
              }
              .width('100%')
            }, (item: TraceTurnSummary) => item.turn.toString())
            ListItem()
              .width('100%')
              .height(24)
          }
          .width('100%')
          .layoutWeight(1)
          .padding({ left: 8, right: 8 })
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
        } else {
          List({ space: 0, scroller: this.inspectorScroller }) {
            ForEach(this.visibleRows(), (item: TraceDisplayRow) => {
              ListItem() {
                Column() {
                  if (item.turnLabel.length > 0) {
                    this.turnDivider(item.turnLabel)
                  }
                  this.traceRowLine(item)
                }
                .width('100%')
                .border({ width: { bottom: 0.5 }, color: this.rowLineColor() })
              }
              .width('100%')
            }, (item: TraceDisplayRow) => item.row.key)
            ListItem()
              .width('100%')
              .height(24)
          }
          .width('100%')
          .layoutWeight(1)
          .padding({ left: 8, right: 8 })
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
        }
      }
    }
    .width('100%')
    .height('100%')
  }
}
