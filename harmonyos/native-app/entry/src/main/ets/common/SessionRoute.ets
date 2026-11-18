const SESSION_ROUTE: string = 'session';

/**
 * 打开会话页：栈顶已经是会话页就「替换」，绝不再叠一层。
 *
 * 之前所有入口都是无脑 pushPathByName('session')：从首页点第二个会话、切换会话、
 * 创建会话……每点一次就在栈里叠一个 ConversationPage。ArkUI 的 NavDestination 被盖住后
 * 组件仍然存活，每个实例都在监听 conversationItems 并在流式期间重排整个时间线，
 * 叠三层等于把一个页面的开销乘三，主线程直接被占满 —— 表现就是「整页点不动、也滑不动」。
 */
export function openSessionRoute(stack: NavPathStack): void {
  const names: string[] = stack.getAllPathName();
  const top: string = names.length > 0 ? names[names.length - 1] : '';
  if (top === SESSION_ROUTE) {
    stack.replacePathByName(SESSION_ROUTE, {}, false);
    return;
  }
  stack.pushPathByName(SESSION_ROUTE, null);
}
