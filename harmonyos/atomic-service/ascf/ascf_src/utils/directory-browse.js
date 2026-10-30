// 目录浏览器（添加工作区）：把网关返回的 crumbs/entries 转成手机端可用的路径与列表。
// 纯函数，便于在没有 wx / 页面的环境下单测。

const POSIX_ROOT = '/';
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]$/;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

/** 该路径是否是文件系统根（POSIX "/"、Windows "C:\\" 或 UNC 共享根）。 */
function isRootPath(value) {
  const text = typeof value === 'string' ? value : '';
  if (text === POSIX_ROOT) return true;
  return WINDOWS_DRIVE_ROOT.test(text) || UNC_PREFIX.test(text);
}

/**
 * 面包屑：保留网关顺序，根标成“电脑”，家目录标成“主目录”，最后一段为当前目录。
 * @param {{path?: string, name?: string}[]} crumbs - 网关返回的祖先链。
 * @param {{root?: string, home?: string}} labels - 两个锚点的界面文案。
 * @param {string} home - 网关返回的家目录绝对路径。
 */
function directoryCrumbTrail(crumbs, labels, home) {
  const rootLabel = (labels && labels.root) || '/';
  const homeLabel = (labels && labels.home) || 'Home';
  const list = Array.isArray(crumbs) ? crumbs : [];
  return list.map((crumb, index) => {
    const path = crumb && typeof crumb.path === 'string' ? crumb.path : '';
    const name = crumb && typeof crumb.name === 'string' && crumb.name ? crumb.name : path;
    let label = name;
    if (isRootPath(path)) label = path === POSIX_ROOT ? rootLabel : name;
    if (home && path === home) label = homeLabel;
    return { path: path, label: label, current: index === list.length - 1 };
  });
}

/** 上一级：根目录返回 null（不再“返回家目录”），没有 crumbs 时也返回 null。 */
function directoryParentPath(crumbs) {
  if (!Array.isArray(crumbs) || crumbs.length < 2) return null;
  const parent = crumbs[crumbs.length - 2];
  return parent && typeof parent.path === 'string' ? parent.path : null;
}

/** 隐藏目录默认不显示，与 dsh 客户端的浏览选择器一致。 */
function visibleDirectoryEntries(entries, showHidden) {
  const list = Array.isArray(entries) ? entries : [];
  return showHidden ? list.slice() : list.filter((entry) => !entry || entry.hidden !== true);
}

/**
 * 把用户输入的路径规范化成绝对路径。支持 "~" / "~/xxx" 展开到网关家目录；
 * 允许 POSIX 绝对路径、Windows 盘符路径和 UNC 路径，其它输入返回错误码。
 * @returns {{path: string}|{error: 'empty'|'not-absolute'}}
 */
function normalizeDirectoryInput(input, home) {
  let value = typeof input === 'string' ? input.trim() : '';
  if (!value) return { error: 'empty' };
  const base = typeof home === 'string' ? home.trim() : '';
  if (value === '~') value = base;
  else if (value.indexOf('~/') === 0 || value.indexOf('~\\') === 0) value = base + value.slice(1);
  if (!value) return { error: 'not-absolute' };
  const posixAbsolute = value.charAt(0) === '/';
  const forwardUnc = /^\/\/[^\/]+\/[^\/]+/.test(value);
  const windowsAbsolute = WINDOWS_DRIVE.test(value) || UNC_PREFIX.test(value);
  if (!posixAbsolute && !windowsAbsolute) return { error: 'not-absolute' };
  if (forwardUnc) {
    const rest = value.slice(2).replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return { path: rest ? '//' + rest : value };
  }
  // 去掉尾部多余分隔符（根路径保留），并把重复分隔符压成一个。
  const separator = value.indexOf('\\') >= 0 && !posixAbsolute ? '\\' : '/';
  const collapsed = value.replace(separator === '/' ? /\/{2,}/g : /\\{2,}/g, separator);
  const trimmed = collapsed.length > 1 ? collapsed.replace(separator === '/' ? /\/+$/ : /\\+$/, '') : collapsed;
  // "C:\" / "D:/" 是盘符根，去掉尾分隔符会变成相对当前盘的 "C:"，必须补回来。
  if (/^[A-Za-z]:$/.test(trimmed)) return { path: trimmed + (separator === '\\' ? '\\' : '/') };
  return { path: trimmed || collapsed || POSIX_ROOT };
}

module.exports = {
  isRootPath,
  directoryCrumbTrail,
  directoryParentPath,
  visibleDirectoryEntries,
  normalizeDirectoryInput
};
