import {
  asRec, GatewayClient, num, ProjStep, ProjTool, ProjTurn, QueueItem, SessionRow, SessionStore, str
} from 'nativecore';

interface FleetNode {
  key: string;
  title: string;
  subtitle: string;
  current: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FleetLink {
  key: string;
  x: number;
  y: number;
  len: number;
  angle: number;
}

class RowsDataSource implements IDataSource {
  private rows: SessionRow[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.rows.length;
  }

  getData(index: number): SessionRow {
    return this.rows[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const index: number = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  reset(rows: SessionRow[]): void {
    this.rows = rows;
    for (const listener of this.listeners) {
      listener.onDataReloaded();
    }
  }
}

interface TabItem {
  key: string;
  label: string;
}

@Component
export struct SessionPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('sessionRows') @Watch('onRowsChanged') rows: SessionRow[] = [];
  @StorageLink('queueItems') queue: QueueItem[] = [];
  @StorageLink('projectedTurns') turns: ProjTurn[] = [];
  @StorageLink('contextDashboard') dashboard: Object | null = null;
  @StorageLink('contextFleet') fleet: Object | null = null;
  @State fleetWidth: number = 0;
  @StorageLink('historyHasMore') hasMoreHistory: boolean = false;
  private scroller: Scroller = new Scroller();
  private rowsSource: RowsDataSource = new RowsDataSource();
  private autoStick: boolean = true;
  @State draft: string = '';
  @State hint: string = '';
  @State tab: string = 'conversation';

  private tabs: TabItem[] = [
    { key: 'conversation', label: '对话' },
    { key: 'queue', label: '排队' },
    { key: 'trajectory', label: '轨迹' },
    { key: 'context', label: '上下文' },
    { key: 'fleet', label: '编队' }
  ];

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
    return this.isDark ? 'rgba(241, 244, 250, 0.62)' : 'rgba(16, 19, 24, 0.62)';
  }

  build() {
    NavDestination() {
      Column() {
        this.tabBar()
        if (this.tab === 'conversation') {
          this.conversationPanel()
        } else if (this.tab === 'queue') {
          this.queuePanel()
        } else if (this.tab === 'trajectory') {
          this.trajectoryPanel()
        } else if (this.tab === 'context') {
          this.contextPanel()
        } else if (this.tab === 'fleet') {
          this.fleetPanel()
        } else {
          this.placeholderPanel()
        }
        if (this.hint.length > 0) {
          Text(this.hint)
            .fontSize(12)
            .fontColor('#FF3B30')
            .padding({ left: 16, right: 16, bottom: 4 })
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .title('会话')
    .backgroundColor(this.pageBg())
  }

  @Builder
  tabBar() {
    Row({ space: 18 }) {
      ForEach(this.tabs, (tab: TabItem) => {
        Column({ space: 6 }) {
          Text(tab.key === 'queue' && this.queue.length > 0
            ? tab.label + ' ' + this.queue.length
            : tab.label)
            .fontSize(15)
            .fontWeight(this.tab === tab.key ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(this.tab === tab.key ? this.textColor() : this.subColor())
          Divider()
            .width(18)
            .color(this.tab === tab.key ? '#2E6BE6' : 'rgba(0,0,0,0)')
        }
        .onClick(() => {
          this.tab = tab.key;
          if (tab.key === 'conversation') {
            this.autoStick = true;
            setTimeout(() => {
              this.scroller.scrollEdge(Edge.Bottom);
            }, 30);
          }
        })
      })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 6 })
  }

  @Builder
  conversationPanel() {
    Column() {
      List({ space: 10 }) {
        if (this.rows.length === 0) {
          ListItem() {
            Column({ space: 6 }) {
              Text(this.connection === 'connected' ? '等待消息…' : '未连接网关')
                .fontSize(15)
                .fontColor(this.textColor())
              Text(this.connection === 'connected'
                ? '已连接：会话历史与流式回复会实时出现在这里。'
                : '到「设置 → 扫码配对」连接 DSH 网关。')
                .fontSize(12)
                .fontColor(this.subColor())
                .textAlign(TextAlign.Center)
            }
            .width('100%')
            .padding(24)
          }
        }
        LazyForEach(this.rowsSource, (row: SessionRow) => {
          ListItem() {
            this.bubble(row)
          }
        }, (row: SessionRow) => row.id)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })
      .scrollBar(BarState.Off)
      .cachedCount(12)
      .onScrollStart(() => {
        this.autoStick = false;
      })

      if (!this.autoStick && this.rows.length > 0) {
        Button('回到底部')
          .height(30)
          .fontSize(12)
          .backgroundColor(this.isDark ? '#2C2C2E' : '#FFFFFF')
          .fontColor('#2E6BE6')
          .margin({ bottom: 6 })
          .onClick(() => {
            this.autoStick = true;
            this.scroller.scrollEdge(Edge.Bottom);
          })
      }
      Row() {
        TextArea({ text: this.draft, placeholder: '输入内容并发送到 DSH' })
          .caretStyle({ width: 1 })
          .onChange((value: string) => {
            this.draft = value;
          })
          .layoutWeight(1)
          .height(44)
          .fontSize(15)
          .fontColor(this.textColor())
          .backgroundColor(this.isDark ? '#2C2C2E' : '#FFFFFF')
          .borderRadius(12)
        Button('发送')
          .height(44)
          .margin({ left: 8 })
          .backgroundColor('#2E6BE6')
          .onClick(() => {
            this.send();
          })
      }
      .width('100%')
      .padding(12)
      .backgroundColor(this.cardBg())
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  queuePanel() {
    Column() {
      if (this.queue.length === 0) {
        Column({ space: 6 }) {
          Text('队列为空')
            .fontSize(15)
            .fontColor(this.textColor())
          Text('回合进行中发送的消息会排在队列里，可「立刻发送」或删除。')
            .fontSize(12)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(24)
      } else {
        List({ space: 10 }) {
          ForEach(this.queue, (item: QueueItem) => {
            ListItem() {
              Column({ space: 8 }) {
                Text(item.preview.length > 0 ? item.preview : '（无文本）')
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .width('100%')
                  .maxLines(3)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Row({ space: 10 }) {
                  Button('立刻发送')
                    .height(32)
                    .fontSize(12)
                    .backgroundColor('#2E6BE6')
                    .onClick(() => {
                      this.queueAction(item.id, 'steer');
                    })
                  Button('删除')
                    .height(32)
                    .fontSize(12)
                    .backgroundColor('#8E8E93')
                    .onClick(() => {
                      this.queueAction(item.id, 'remove');
                    })
                }
                .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .borderRadius(14)
              .backgroundColor(this.cardBg())
            }
          }, (item: QueueItem) => item.id)
        }
        .layoutWeight(1)
        .width('100%')
        .padding(16)
        .scrollBar(BarState.Off)
      }
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  trajectoryPanel() {
    Column() {
      if (this.turns.length === 0) {
        Column({ space: 6 }) {
          Text('暂无轨迹')
            .fontSize(15)
            .fontColor(this.textColor())
          Text('收到回合事件后会按「轮次 → 步骤 → 工具调用」显示在这里。')
            .fontSize(12)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(24)
      } else {
        List({ space: 10 }) {
          ForEach(this.turns, (turn: ProjTurn) => {
            ListItem() {
              Column({ space: 8 }) {
                Row() {
                  Text('第 ' + turn.turn + ' 轮')
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Blank()
                  Text(turn.status === 'running' ? '进行中' : '已完成')
                    .fontSize(11)
                    .fontColor(turn.status === 'running' ? '#34C759' : this.subColor())
                }
                .width('100%')
                if (turn.userText.length > 0) {
                  Text(turn.userText)
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .width('100%')
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                ForEach(turn.steps, (step: ProjStep) => {
                  Column({ space: 6 }) {
                    Text('步骤 ' + step.step + (step.status === 'running' ? ' · 执行中' : ''))
                      .fontSize(12)
                      .fontColor(this.subColor())
                      .width('100%')
                    ForEach(step.tools, (tool: ProjTool) => {
                      Row({ space: 8 }) {
                        Circle()
                          .width(7)
                          .height(7)
                          .fill(tool.status === 'running' ? '#FFCC00'
                            : (tool.status === 'error' ? '#FF3B30' : '#34C759'))
                        Text(tool.name)
                          .fontSize(14)
                          .fontColor(this.textColor())
                          .layoutWeight(1)
                        Text(tool.status === 'running' ? '执行中' : (tool.status === 'error' ? '失败' : '完成'))
                          .fontSize(11)
                          .fontColor(this.subColor())
                      }
                      .width('100%')
                      .padding({ top: 2, bottom: 2 })
                    }, (tool: ProjTool) => tool.callId)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .width('100%')
                }, (step: ProjStep) => step.step.toString())
              }
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .borderRadius(14)
              .backgroundColor(this.cardBg())
            }
          }, (turn: ProjTurn) => turn.turn.toString())
        }
        .layoutWeight(1)
        .width('100%')
        .padding(16)
        .scrollBar(BarState.Off)
      }
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  contextPanel() {
    Column({ space: 10 }) {
      Row({ space: 10 }) {
        this.metricTile('请求数', this.dashNumber('requests', true))
        this.metricTile('上下文窗口', this.dashText('contextWindow'))
        this.metricTile('轮次', this.dashText('stats.turns'))
      }
      .padding({ left: 16, right: 16, top: 12 })
      List({ space: 8 }) {
        if (this.dashRequests().length === 0) {
          ListItem() {
            Column({ space: 6 }) {
              Text('暂无上下文数据')
                .fontSize(15)
                .fontColor(this.textColor())
              Text('连接会话后会自动拉取 context-dashboard。')
                .fontSize(12)
                .fontColor(this.subColor())
                .textAlign(TextAlign.Center)
            }
            .width('100%')
            .padding(24)
          }
        }
        ForEach(this.dashRequests(), (request: Object) => {
          ListItem() {
            Row() {
              Text('#' + (str(request, 'seq') ?? '-'))
                .fontSize(13)
                .fontColor(this.subColor())
                .width(64)
              Text('输入 ' + (num(asRec(str(request, 'usage')) ?? undefined, 'uncachedInputTokens') ?? 0).toString() + ' tok')
                .fontSize(13)
                .fontColor(this.textColor())
                .layoutWeight(1)
              Text('输出 ' + (num(asRec(str(request, 'usage')) ?? undefined, 'outputTokens') ?? 0).toString() + ' tok')
                .fontSize(13)
                .fontColor(this.subColor())
            }
            .width('100%')
            .padding(12)
            .borderRadius(12)
            .backgroundColor(this.cardBg())
          }
        }, (request: Object, index: number) => index.toString())
      }
      .layoutWeight(1)
      .width('100%')
      .padding(16)
      .scrollBar(BarState.Off)
    }
    .layoutWeight(1)
    .width('100%')
  }

  @Builder
  fleetPanel() {
    Stack() {
      ForEach(this.fleetLinks(), (link: FleetLink) => {
        Row()
          .width(link.len)
          .height(1)
          .backgroundColor(this.isDark ? 'rgba(241,244,250,0.28)' : 'rgba(16,19,24,0.22)')
          .position({ x: link.x, y: link.y })
          .rotate({ angle: link.angle })
      }, (link: FleetLink) => link.key)

      ForEach(this.fleetNodes(), (node: FleetNode) => {
        Column({ space: 6 }) {
          Row() {
            Text(node.title)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.textColor())
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(node.current ? '当前' : '子 Agent')
              .fontSize(10)
              .fontColor(node.current ? '#34C759' : this.subColor())
          }
          .width('100%')
          Text(node.subtitle)
            .fontSize(10)
            .fontColor(this.subColor())
            .width('100%')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .alignItems(HorizontalAlign.Start)
        .padding(12)
        .width(node.w)
        .height(node.h)
        .borderRadius(14)
        .backgroundColor(this.cardBg())
        .border({ width: node.current ? 1.5 : 1, color: node.current ? '#2E6BE6' : (this.isDark ? 'rgba(241,244,250,0.10)' : 'rgba(16,19,24,0.08)') })
        .position({ x: node.x, y: node.y })
      }, (node: FleetNode) => node.key)
    }
    .width('100%')
    .height(this.fleetHeight())
    .onAreaChange((oldValue: Area, newValue: Area) => {
      const width: number = Number(newValue.width);
      if (width > 0 && Math.abs(width - this.fleetWidth) > 1) {
        this.fleetWidth = width;
      }
    })
    .layoutWeight(1)
  }

  private fleetNodes(): FleetNode[] {
    const agents: Object[] = this.fleetAgents();
    if (agents.length === 0) {
      return [];
    }
    const width: number = this.fleetWidth > 0 ? this.fleetWidth - 32 : 328;
    const nodes: FleetNode[] = [];
    const rootH: number = 76;
    const childH: number = 72;
    const gapY: number = 34;
    const cols: number = width >= 320 ? 2 : 1;
    const gapX: number = 10;
    const childW: number = (width - (cols - 1) * gapX) / cols;
    const titles: Object[] = agents;
    // 当前 Agent 作为根节点；其余作为子节点。
    let rootIndex: number = -1;
    for (let i = 0; i < titles.length; i++) {
      if (this.agentCurrent(titles[i])) {
        rootIndex = i;
        break;
      }
    }
    const root: Object | undefined = rootIndex >= 0 ? titles[rootIndex] : titles[0];
    const children: Object[] = [];
    for (let i = 0; i < titles.length; i++) {
      if (i !== rootIndex && titles[i] !== root) {
        children.push(titles[i]);
      }
    }
    nodes.push({
      key: 'root',
      title: this.agentTitle(root),
      subtitle: (str(root, 'sessionId') ?? '').substring(0, 18),
      current: true,
      x: 16,
      y: 8,
      w: width,
      h: rootH
    });
    for (let i = 0; i < children.length; i++) {
      const row: number = Math.floor(i / cols);
      const col: number = i % cols;
      nodes.push({
        key: 'child-' + i,
        title: this.agentTitle(children[i]),
        subtitle: (str(children[i], 'sessionId') ?? '').substring(0, 18),
        current: false,
        x: 16 + col * (childW + gapX),
        y: 8 + rootH + gapY + row * (childH + 12),
        w: childW,
        h: childH
      });
    }
    return nodes;
  }

  private fleetLinks(): FleetLink[] {
    const nodes: FleetNode[] = this.fleetNodes();
    if (nodes.length <= 1) {
      return [];
    }
    const root: FleetNode = nodes[0];
    const links: FleetLink[] = [];
    const startX: number = root.x + root.w / 2;
    const startY: number = root.y + root.h;
    for (let i = 1; i < nodes.length; i++) {
      const node: FleetNode = nodes[i];
      const endX: number = node.x + node.w / 2;
      const endY: number = node.y;
      const dx: number = endX - startX;
      const dy: number = endY - startY;
      const len: number = Math.sqrt(dx * dx + dy * dy);
      const angle: number = Math.atan2(dy, dx) * 180 / Math.PI;
      links.push({
        key: 'link-' + i,
        x: (startX + endX) / 2 - len / 2,
        y: (startY + endY) / 2 - 0.5,
        len: len,
        angle: angle
      });
    }
    return links;
  }

  private fleetHeight(): number {
    const nodes: FleetNode[] = this.fleetNodes();
    if (nodes.length === 0) {
      return 240;
    }
    let maxBottom: number = 0;
    for (const node of nodes) {
      const bottom: number = node.y + node.h;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    }
    return maxBottom + 24;
  }

  @Builder
  metricTile(label: string, value: string) {
    Column({ space: 4 }) {
      Text(value)
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(label)
        .fontSize(11)
        .fontColor(this.subColor())
    }
    .alignItems(HorizontalAlign.Start)
    .padding(12)
    .borderRadius(12)
    .backgroundColor(this.cardBg())
    .layoutWeight(1)
  }

  private dashRecord(): Record<string, Object> | undefined {
    return this.dashboard === null ? undefined : asRec(this.dashboard);
  }

  private dashNumber(key: string, isArray: boolean): string {
    const record = this.dashRecord();
    if (record === undefined) {
      return '—';
    }
    const value = record[key];
    if (isArray && Array.isArray(value)) {
      return (value as Object[]).length.toString();
    }
    if (typeof value === 'number') {
      return (value as number).toString();
    }
    return '—';
  }

  private dashText(path: string): string {
    const record = this.dashRecord();
    if (record === undefined) {
      return '—';
    }
    const parts: string[] = path.split('.');
    if (parts.length === 1) {
      const value = record[parts[0]];
      return typeof value === 'number' ? (value as number).toString() : '—';
    }
    const nested = asRec(record[parts[0]]);
    if (nested === undefined) {
      return '—';
    }
    const inner = num(nested, parts[1]);
    return inner !== undefined ? inner.toString() : '—';
  }

  private dashRequests(): Object[] {
    const record = this.dashRecord();
    if (record === undefined) {
      return [];
    }
    const value = record['requests'];
    if (!Array.isArray(value)) {
      return [];
    }
    const all: Object[] = value as Object[];
    return all.slice(Math.max(0, all.length - 8)).reverse();
  }

  private fleetAgents(): Object[] {
    if (this.fleet === null) {
      return [];
    }
    const record = asRec(this.fleet);
    if (record === undefined) {
      return [];
    }
    const value = record['agents'];
    return Array.isArray(value) ? (value as Object[]) : [];
  }

  private agentTitle(agent: Object): string {
    return str(agent, 'title') ?? str(agent, 'name') ?? str(agent, 'sessionId') ?? 'Agent';
  }

  private agentCurrent(agent: Object): boolean {
    const flag = asRec(agent);
    if (flag !== undefined && flag['isCurrent'] === true) {
      return true;
    }
    return (str(agent, 'sessionId') ?? '') === SessionStore.get().currentSessionId();
  }

  @Builder
  placeholderPanel() {
    Column({ space: 8 }) {
      Text('该面板待接入')
        .fontSize(15)
        .fontColor(this.textColor())
      Text('轨迹 / 上下文 / 编队需要先迁 protocol.js 的事件投影，下一阶段补齐。')
        .fontSize(12)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .padding(24)
    .layoutWeight(1)
  }

  @Builder
  bubble(row: SessionRow) {
    Row() {
      Column({ space: 4 }) {
        Text(row.role === 'user' ? '你' : (row.role === 'tool' ? '工具' : 'DSH'))
          .fontSize(11)
          .fontColor(this.subColor())
        Text(row.text.length > 0 ? row.text : '…')
          .fontSize(15)
          .lineHeight(22)
          .fontColor(this.textColor())
      }
      .alignItems(HorizontalAlign.Start)
      .padding(12)
      .borderRadius(14)
      .backgroundColor(row.role === 'user'
        ? (this.isDark ? '#0A3D91' : '#DCE8FF')
        : this.cardBg())
      .width('100%')
    }
    .width('100%')
    .justifyContent(row.role === 'user' ? FlexAlign.End : FlexAlign.Start)
  }

  aboutToAppear(): void {
    this.rowsSource.reset(this.rows);
  }

  onRowsChanged(): void {
    this.rowsSource.reset(this.rows);
    if (this.tab !== 'conversation' || !this.autoStick) {
      return;
    }
    setTimeout(() => {
      this.scroller.scrollEdge(Edge.Bottom);
    }, 30);
  }

  private loadOlder(): void {
    if (!SessionStore.get().loadOlder()) {
      this.hint = '没有更早的记录了';
    }
  }

  private send(): void {
    const text: string = this.draft.trim();
    if (text.length === 0) {
      return;
    }
    const client = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关：请先在设置页扫码配对';
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (!client.sendUserMessage(text, sessionId)) {
      this.hint = '发送失败，请检查连接';
      return;
    }
    this.hint = '';
    this.draft = '';
  }

  private queueAction(itemId: string, action: string): void {
    const client = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (!client.queueUpdate(sessionId, itemId, action)) {
      this.hint = '操作失败，请重试';
    }
  }
}
