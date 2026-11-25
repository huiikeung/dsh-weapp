/**
 * 底部弹窗系统材质（与首页 Chief 卡同一套）：
 * 支持沉浸材质的系统用 ImmersiveMaterial（透明底 + 系统玻璃），否则退回半透明实色。
 */
import { uiMaterial } from '@kit.ArkUI';

export function immersiveSheetSupported(): boolean {
  try {
    return uiMaterial.isImmersiveMaterialSupported();
  } catch (error) {
    return false;
  }
}

export function sheetSystemMaterial(isDark: boolean): uiMaterial.Material | undefined {
  if (!immersiveSheetSupported()) {
    return undefined;
  }
  return new uiMaterial.ImmersiveMaterial({
    style: uiMaterial.ImmersiveStyle.THICK,
    materialColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
    colorInvert: true,
    applyShadow: true
  });
}

export function sheetFallbackColor(isDark: boolean): string {
  return isDark ? '#2E2E2E' : '#F7F8FA';
}
