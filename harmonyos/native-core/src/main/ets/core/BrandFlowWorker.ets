import { renderBrandFlow, renderBotFlow } from './BrandFlow';

@Concurrent
export function prepareBrandFlow(width: number, height: number, aspect: number, seconds: number, wide: boolean): ArrayBuffer { return renderBrandFlow(width,height,aspect,seconds,wide); }

/** Bot 主题流体：按配色预设 + 深浅色在 TaskPool 内渲染，主线程只缩放位图 */
@Concurrent
export function prepareBotFlow(width: number, height: number, aspect: number, night: boolean, presetId: string): ArrayBuffer { return renderBotFlow(width,height,aspect,0,night,presetId); }
