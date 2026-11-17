import { asset } from '@kit.AssetStoreKit';
import { utf8Decode, utf8Encode } from '../crypto/DshCrypto';

/**
 * HarmonyOS AssetStore wrapper for sensitive gateway credentials.
 * Falls back to null when the device policy or asset service is unavailable;
 * callers can then migrate from the legacy Preferences record.
 */
export class SecureCredentialStore {
  private static readonly ALIAS: string = 'dsh.gateway.credentials.v1';

  static read(): string | null {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, utf8Encode(SecureCredentialStore.ALIAS));
      const values: asset.AssetMap[] = asset.querySync(query);
      if (values.length === 0) return null;
      const secret: asset.Value | undefined = values[0].get(asset.Tag.SECRET);
      return secret instanceof Uint8Array ? utf8Decode(secret) : null;
    } catch (err) {
      return null;
    }
  }

  static write(value: string): boolean {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, utf8Encode(SecureCredentialStore.ALIAS));
      const updated: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      updated.set(asset.Tag.SECRET, utf8Encode(value));
      try {
        asset.updateSync(query, updated);
      } catch (err) {
        const created: asset.AssetMap = new Map<asset.Tag, asset.Value>();
        created.set(asset.Tag.ALIAS, utf8Encode(SecureCredentialStore.ALIAS));
        created.set(asset.Tag.SECRET, utf8Encode(value));
        created.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_POWERED_ON);
        asset.addSync(created);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  static clear(): void {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, utf8Encode(SecureCredentialStore.ALIAS));
      asset.removeSync(query);
    } catch (err) {
      // Missing/unavailable assets are already cleared from the app's perspective.
    }
  }
}
