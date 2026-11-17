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
      const titles: Record<string, string> = {
        'shell': '终端',
        'agent-loop': 'Agent 循环',
        'subagent': '子智能体',
        'web-search': '网页搜索'
      };
      const descriptions: Record<string, string> = {
        'shell': '限制每条命令最多能跑多久、最多输出多少内容。',
        'agent-loop': '控制 Agent 派发工具调用的方式。',
        'subagent': '设置子智能体的递归层级、数量和模型。',
        'web-search': '设置 DeepSeek 的搜索提供方。'
      };
      officialItems.push({
        id: id,
        title: (meta !== undefined ? localized(meta['title']) : '') || (titles[id] ?? id),
        description: (meta !== undefined ? localized(meta['description']) : '') || (descriptions[id] ?? ''),
        icon: meta !== undefined ? (str(meta, 'icon') ?? '') : ''
      });
    }
    AppStorage.setOrCreate<OfficialPluginItem[]>('pluginOfficialItems', officialItems.slice());
    AppStorage.setOrCreate<boolean>('pluginManagementAvailable', this.managementAvailable);
    Logger.info('catalog frame=' + JSON.stringify(frame).substring(0, 1200));
    Logger.info('plugin catalog bundles=' + items.length + ' official=' + officialItems.length);
  }

  list(): PluginItem[] {
    return this.bundles;
  }
}
