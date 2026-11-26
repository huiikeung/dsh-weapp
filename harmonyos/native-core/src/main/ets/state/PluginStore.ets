import { GatewayFrame } from '../protocol/GatewayDtos';
import { asRec, str, bool } from '../protocol/GatewayFrameCodec';
import { Logger } from '../common/Logger';

/** 插件包（对齐小程序 utils/plugins.js 的 parseBundle 精简版）。 */
export interface PluginItem {
  name: string;
  title: string;
  description: string;
  version: string;
  enabled: boolean;
  experimental: boolean;
  availability: string;
  installed: boolean;
  optional: boolean;
  official: boolean;
  updateAvailable: boolean;
  error: string;
  icon: string;
}

/** 内置插件配置项（对齐小程序 officialItems）。 */
export interface OfficialPluginItem {
  id: string;
  title: string;
  description: string;
  icon: string;
}

function localized(value: Object | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value as string;
  }
  const rec = asRec(value);
  if (rec === undefined) {
    return '';
  }
  const zh = str(rec, 'zh');
  if (zh !== undefined && zh.length > 0) {
    return zh;
  }
  const en = str(rec, 'en');
  if (en !== undefined && en.length > 0) {
    return en;
  }
  return '';
}

function errorText(raw: Object): string {
  const rec = asRec(raw);
  if (rec === undefined) {
    return '';
  }
  const direct = str(rec, 'error');
  if (direct !== undefined) {
    return direct;
  }
  const err = asRec(rec['error']);
  if (err !== undefined) {
    return str(err, 'diagnostic') ?? str(err, 'code') ?? '';
  }
  return '';
}

/** 插件目录：`plugin-catalog` 帧 → 列表 + 内置配置项。 */
export class PluginStore {
  private static instance: PluginStore = new PluginStore();
  private bundles: PluginItem[] = [];
  private managementAvailable: boolean = false;

  static get(): PluginStore {
    return PluginStore.instance;
  }

  consume(frame: GatewayFrame): void {
    if (frame.kind !== 'plugin-catalog') {
      if (frame.kind.indexOf('plugin') >= 0 || frame.kind === 'error') {
        Logger.info('consume kind=' + frame.kind + ' body=' + JSON.stringify(frame).substring(0, 400));
      }
      return;
    }
    Logger.info('consume catalog start');
    if (frame.managementAvailable !== undefined) {
      this.managementAvailable = frame.managementAvailable;
    }
    const frameRec: Record<string, Object> | undefined = asRec(frame as Object);
    const rawResult: Object | undefined = frameRec !== undefined ? frameRec['result'] : undefined;
    const resultRec: Record<string, Object> | undefined = rawResult !== undefined ? asRec(rawResult) : undefined;
    let rawBundles: Object[] = frame.bundles !== undefined ? frame.bundles : [];
    if (rawBundles.length === 0 && frameRec !== undefined) {
      const nested = frameRec['bundles'];
      if (Array.isArray(nested)) {
        rawBundles = nested as Object[];
      }
    }
    if (rawBundles.length === 0 && resultRec !== undefined) {
      const nestedResult = resultRec['bundles'];
      if (Array.isArray(nestedResult)) {
        rawBundles = nestedResult as Object[];
      }
    }
    const items: PluginItem[] = [];
    for (const raw of rawBundles) {
      const record = asRec(raw);
      if (record === undefined) {
        continue;
      }
      const name: string = str(raw, 'name') ?? '';
      if (name.length === 0) {
        continue;
      }
      const meta = asRec(record['meta']);
      const installTarget = asRec(record['installTarget']);
      const installed: boolean = bool(raw, 'installed') === true;
      const optionalFlag: boolean = bool(raw, 'optional') === true;
      const officialFlag: boolean = bool(raw, 'official') === true || (optionalFlag && !installed);
      const version: string = str(raw, 'version') ?? '';
      const targetVersion: string = installTarget !== undefined ? (str(installTarget, 'version') ?? '') : '';
      const errText: string = errorText(raw);
      const visible: boolean = installed || optionalFlag || officialFlag || errText.length > 0;
      const explicitVisible = bool(raw, 'visible');
      if (!visible || explicitVisible === false) {
        continue;
      }
      const title: string = (meta !== undefined ? localized(meta['title']) : '') || name;
      const description: string = (meta !== undefined ? localized(meta['description']) : '')
        || (str(raw, 'description') ?? '');
      const icon: string = meta !== undefined ? (str(meta, 'icon') ?? '') : '';
      items.push({
        name: name,
        title: title,
        description: description,
        version: version,
        enabled: bool(raw, 'enabled') === true,
        experimental: bool(raw, 'experimental') === true || name.indexOf('dsh-experimental-') >= 0,
        availability: str(raw, 'availability') ?? '',
        installed: installed,
        optional: optionalFlag,
        official: officialFlag,
        updateAvailable: bool(raw, 'updateAvailable') === true
          || (installed && version.length > 0 && targetVersion.length > 0 && targetVersion !== version),
        error: errText,
        icon: icon
      });
    }
    this.bundles = items;
    AppStorage.setOrCreate<PluginItem[]>('pluginBundles', items.slice());

    const officialItems: OfficialPluginItem[] = [];
    let rawOfficial: Object[] = frame.officialItems !== undefined ? frame.officialItems : [];
    if (rawOfficial.length === 0 && resultRec !== undefined) {
      const nestedOfficial = resultRec['officialItems'];
      if (Array.isArray(nestedOfficial)) {
        rawOfficial = nestedOfficial as Object[];
      }
    }
    for (const raw of rawOfficial) {
      const record = asRec(raw);
      if (record === undefined) {
        continue;
      }
      const id: string = str(raw, 'id') ?? '';
      if (id.length === 0) {
        continue;
      }
      const meta = asRec(record['meta']);
      // 名称/描述以主机下发为准（item.title/description 或 item.meta.*），
      // 兼容 dsh 端 i18n 对象 {zh,en}；主机没给时才用下面这份兜底文案。
      // 兜底文案与 dsh 桌面端一致（文案/顺序都对齐），改名时同步这里即可。
      const titles: Record<string, string> = {
        'subagent': '子智能体',
        'web-search': '网页搜索与获取',
        'agent-loop': 'Agent 循环',
        'shell': '终端'
      };
      const descriptions: Record<string, string> = {
        'subagent': '设置子智能体的递归层级、数量和模型。',
        'web-search': '选择网页搜索与网页获取使用的提供方。',
        'agent-loop': '控制 Agent 派发工具调用的方式。',
        'shell': '限制每条命令最多能跑多久、最多输出多少内容。'
      };
      const hostTitle: string = localized(record['title'])
        || (meta !== undefined ? localized(meta['title']) : '');
      const hostDescription: string = localized(record['description'])
        || (meta !== undefined ? localized(meta['description']) : '');
      officialItems.push({
        id: id,
        title: hostTitle.length > 0 ? hostTitle : (titles[id] ?? id),
        description: hostDescription.length > 0 ? hostDescription : (descriptions[id] ?? ''),
        icon: meta !== undefined ? (str(meta, 'icon') ?? '') : (str(record, 'icon') ?? '')
      });
    }
    // 顺序对齐 dsh 桌面端：子智能体 → 网页搜索与获取 → Agent 循环 → 终端
    const order: string[] = ['subagent', 'web-search', 'agent-loop', 'shell'];
    officialItems.sort((a: OfficialPluginItem, b: OfficialPluginItem) => {
      const ia: number = order.indexOf(a.id);
      const ib: number = order.indexOf(b.id);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    });
    AppStorage.setOrCreate<OfficialPluginItem[]>('pluginOfficialItems', officialItems.slice());
    AppStorage.setOrCreate<boolean>('pluginManagementAvailable', this.managementAvailable);
    Logger.info('catalog frame=' + JSON.stringify(frame).substring(0, 1200));
    Logger.info('plugin catalog bundles=' + items.length + ' official=' + officialItems.length);
  }

  list(): PluginItem[] {
    return this.bundles;
  }
}
