export const KEY_CONNECTION: string = 'connectionState';
export const KEY_WORKSPACE: string = 'workspaceName';

/** 全局状态键初始化：页面用 @StorageLink 之前先保证键存在。 */
export class AppState {
  static init(): void {
    if (AppStorage.get<string>(KEY_CONNECTION) === undefined) {
      AppStorage.setOrCreate<string>(KEY_CONNECTION, 'disconnected');
    }
    if (AppStorage.get<string>(KEY_WORKSPACE) === undefined) {
      AppStorage.setOrCreate<string>(KEY_WORKSPACE, '');
    }
    if (AppStorage.get<boolean>('isDark') === undefined) {
      AppStorage.setOrCreate<boolean>('isDark', false);
    }
    if (AppStorage.get<string>('themeMode') === undefined) {
      AppStorage.setOrCreate<string>('themeMode', 'dark');
    }
  }
}
