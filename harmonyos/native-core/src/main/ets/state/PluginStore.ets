import { GatewayFrame } from '../protocol/GatewayDtos';
import { asRec, str, num, bool } from '../protocol/GatewayFrameCodec';
import { Logger } from '../common/Logger';

export interface PluginItem {
  name: string;
  title: string;
  description: string;
  version: string;
  enabled: boolean;
  experimental: boolean;
  availability: string;
}

/** 插件目录：`plugin-catalog` 帧 → 列表视图。 */
export class PluginStore {
  private static instance: PluginStore = new PluginStore();
  private bundles: PluginItem[] = [];
  private managementAvailable: boolean = false;

  static get(): PluginStore {
    return PluginStore.instance;
  }

  consume(frame: GatewayFrame): void {
    if (frame.kind !== 'plugin-catalog') {
      return;
    }
    if (frame.managementAvailable !== undefined) {
      this.managementAvailable = frame.managementAvailable;
    }
    const rawBundles: Object[] = frame.bundles !== undefined ? frame.bundles : [];
    const items: PluginItem[] = [];
    for (const raw of rawBundles) {
      const record = asRec(raw);
      if (record === undefined) {
        continue;
      }
      const visible = bool(raw, 'visible');
      if (visible === false) {
        continue;
      }
      const name: string = str(raw, 'name') ?? '';
      if (name.length === 0) {
        continue;
      }
      items.push({
        name: name,
        title: str(raw, 'title') ?? str(raw, 'displayName') ?? name,
        description: str(raw, 'description') ?? '',
        version: str(raw, 'version') ?? '',
        enabled: bool(raw, 'enabled') === true,
        experimental: bool(raw, 'experimental') === true,
        availability: str(raw, 'availability') ?? ''
      });
    }
    this.bundles = items;
    AppStorage.setOrCreate<PluginItem[]>('pluginBundles', items.slice());
    AppStorage.setOrCreate<boolean>('pluginManagementAvailable', this.managementAvailable);
    Logger.info('plugin catalog bundles=' + items.length);
  }

  list(): PluginItem[] {
    return this.bundles;
  }
}
