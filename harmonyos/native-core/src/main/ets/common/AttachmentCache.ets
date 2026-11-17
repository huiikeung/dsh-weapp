import { common, Want } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';

export interface AttachmentCacheEntry {
  path: string;
  name: string;
  bytes: number;
}

export class AttachmentCache {
  private static dir(context: common.UIAbilityContext): string {
    return context.filesDir + '/dsh-downloads';
  }

  static async list(context: common.UIAbilityContext): Promise<AttachmentCacheEntry[]> {
    const root: string = AttachmentCache.dir(context);
    try {
      const names: string[] = await fileIo.listFile(root);
      const result: AttachmentCacheEntry[] = [];
      for (const name of names) {
        // Active download temporary files are owned by the transfer, not cache cleanup.
        if (name.startsWith('.') && name.endsWith('.part')) continue;
        const path: string = root + '/' + name;
        try {
          const stat = await fileIo.stat(path);
          if (stat.isDirectory()) continue;
          result.push({ path: path, name: name, bytes: stat.size });
        } catch (err) { }
      }
      return result;
    } catch (err) {
      return [];
    }
  }

  static async bytes(context: common.UIAbilityContext): Promise<number> {
    const entries: AttachmentCacheEntry[] = await AttachmentCache.list(context);
    let total: number = 0;
    for (const entry of entries) total += entry.bytes;
    return total;
  }

  static async openExternally(context: common.UIAbilityContext, path: string, mime: string): Promise<void> {
    const root: string = AttachmentCache.dir(context);
    const prefix: string = root + '/';
    if (!path.startsWith(prefix)) throw new Error('缓存文件路径无效');
    const name: string = path.substring(prefix.length);
    if (name.length === 0 || name.indexOf('/') >= 0 || name === '.' || name === '..' || name.startsWith('.')) {
      throw new Error('缓存文件路径无效');
    }
    const stat = await fileIo.stat(path);
    if (stat.isDirectory()) throw new Error('不能打开目录');
    const safeMime: string = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9*#$&^_.+-]+$/.test(mime) ? mime : '*/*';
    const encodedPath: string = path.split('/').map((part: string) => encodeURIComponent(part)).join('/');
    const want: Want = {
      uri: 'file://' + encodedPath,
      type: safeMime,
      flags: 0x00000001 | 0x00000002
    };
    await context.startAbility(want);
  }

  static async clear(context: common.UIAbilityContext): Promise<number> {
    const entries: AttachmentCacheEntry[] = await AttachmentCache.list(context);
    let removed: number = 0;
    for (const entry of entries) {
      try { await fileIo.unlink(entry.path); removed += 1; } catch (err) { }
    }
    return removed;
  }
}
