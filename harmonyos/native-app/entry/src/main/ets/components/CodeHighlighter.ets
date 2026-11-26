/**
 * 轻量代码高亮 tokenizer（对齐 dsh 端代码块的观感）：
 *   关键字 / 字符串 / 数字 / 注释 四类着色，其余用默认正文色。
 * 单遍字符扫描，O(n)，不追求编译级精确 —— 够看就行（dsh 端用的也是近似高亮）。
 * 支持：ts/js/ets、python、go、java/kotlin、c/cpp、rust、sh、json、yaml 等常见语言。
 */
export interface CodeToken {
  /** 分片文本 */
  text: string;
  /** token 种类：''=默认 kw=关键字 str=字符串 num=数字 com=注释 */
  kind: string;
}

/** 关键字并集（多语言混用一套，误伤率可接受） */
const KEYWORDS: Set<string> = new Set<string>([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'elif', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'implements', 'interface',
  'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'this', 'super', 'yield', 'delete', 'void', 'in', 'of', 'static',
  'get', 'set', 'public', 'private', 'protected', 'readonly', 'type', 'enum', 'namespace', 'as',
  'def', 'lambda', 'pass', 'raise', 'with', 'and', 'or', 'not', 'is', 'global', 'nonlocal',
  'assert', 'del', 'func', 'package', 'range', 'struct', 'map', 'chan', 'go', 'defer', 'select',
  'val', 'fun', 'when', 'object', 'override', 'open', 'init', 'self', 'fn', 'impl', 'match',
  'mut', 'pub', 'use', 'where', 'end', 'then', 'local'
]);

const LITERALS: Set<string> = new Set<string>([
  'true', 'false', 'null', 'undefined', 'none', 'nil'
]);

function isWordChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

/** hash 注释语言（python / shell / yaml） */
function hashCommentLang(lang: string): boolean {
  return lang === 'python' || lang === 'py' || lang === 'sh' || lang === 'bash' || lang === 'shell'
    || lang === 'yaml' || lang === 'yml' || lang === 'ruby' || lang === 'rb' || lang === 'toml'
    || lang === 'dockerfile' || lang === 'makefile' || lang === 'conf' || lang === 'ini';
}

export function highlightCode(text: string, language: string): CodeToken[] {
  const lang: string = language.toLowerCase();
  const out: CodeToken[] = [];
  const buf: string[] = [];
  let mode: string = ''; // ''=普通 'line' 'block' 'squote' 'dquote' 'template'
  const flush = (): void => {
    if (buf.length > 0) {
      const joined: string = buf.join('');
      buf.length = 0;
      if (joined.length > 0) {
        const token: CodeToken = { text: joined, kind: '' };
        out.push(token);
      }
    }
  };
  const pushToken = (value: string, kind: string): void => {
    flush();
    if (value.length > 0) {
      const token: CodeToken = { text: value, kind: kind };
      out.push(token);
    }
  };
  const n: number = text.length;
  let i: number = 0;
  while (i < n) {
    const c: string = text[i];
    if (mode === 'line') {
      if (c === '\n') {
        pushToken('\n', 'com');
        mode = '';
        i += 1;
        continue;
      }
      buf.push(c);
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && i + 1 < n && text[i + 1] === '/') {
        buf.push('*/');
        pushToken(buf.join(''), 'com');
        buf.length = 0;
        mode = '';
        i += 2;
        continue;
      }
      buf.push(c);
      i += 1;
      continue;
    }
    if (mode === 'squote' || mode === 'dquote' || mode === 'template') {
      const quote: string = mode === 'squote' ? String.fromCharCode(39) : (mode === 'dquote' ? String.fromCharCode(34) : String.fromCharCode(96));
      if (c === String.fromCharCode(92) && i + 1 < n) {
        buf.push(text[i + 1]);
        i += 2;
        continue;
      }
      if (c === quote) {
        buf.push(quote);
        pushToken(buf.join(''), 'str');
        buf.length = 0;
        mode = '';
        i += 1;
        continue;
      }
      buf.push(c);
      i += 1;
      continue;
    }
    // 普通态
    if (c === '/' && i + 1 < n && text[i + 1] === '/') {
      flush();
      buf.push('//');
      mode = 'line';
      i += 2;
      continue;
    }
    if (c === '/' && i + 1 < n && text[i + 1] === '*') {
      flush();
      buf.push('/*');
      mode = 'block';
      i += 2;
      continue;
    }
    if (c === '#' && hashCommentLang(lang)) {
      flush();
      buf.push('#');
      mode = 'line';
      i += 1;
      continue;
    }
    if (c === String.fromCharCode(39)) {
      flush();
      buf.push(c);
      mode = 'squote';
      i += 1;
      continue;
    }
    if (c === String.fromCharCode(34)) {
      flush();
      buf.push(c);
      mode = 'dquote';
      i += 1;
      continue;
    }
    if (c === String.fromCharCode(96)) {
      flush();
      buf.push(c);
      mode = 'template';
      i += 1;
      continue;
    }
    if (isDigit(c) && (i === 0 || !isWordChar(text[i - 1]))) {
      // 数字（含 0x / 0b 前缀与小数）
      let j: number = i + 1;
      while (j < n && (isDigit(text[j]) || text[j] === '.' || text[j] === '_' || (j > i + 1 && ((text[j] >= 'a' && text[j] <= 'f') || (text[j] >= 'A' && text[j] <= 'F') || text[j] === 'x' || text[j] === 'X' || text[j] === 'b' || text[j] === 'o')))) {
        j += 1;
      }
      pushToken(text.substring(i, j), 'num');
      i = j;
      continue;
    }
    if (isWordChar(c) && !(c >= '0' && c <= '9')) {
      let j: number = i + 1;
      while (j < n && isWordChar(text[j])) {
        j += 1;
      }
      const word: string = text.substring(i, j);
      const lower: string = word.toLowerCase();
      if (KEYWORDS.has(lower)) {
        pushToken(word, 'kw');
      } else if (LITERALS.has(lower)) {
        pushToken(word, 'num');
      } else {
        buf.push(word);
      }
      i = j;
      continue;
    }
    buf.push(c);
    i += 1;
  }
  flush();
  if (mode.length > 0 && buf.length > 0) {
    // 未闭合的字符串/注释：残留内容按对应颜色吐出
    const rest: string = buf.join('');
    buf.length = 0;
    pushToken(rest, mode === 'line' || mode === 'block' ? 'com' : 'str');
  }
  return out;
}
