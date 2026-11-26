/**
 * MarkdownLite —— 轻量 Markdown 解析（纯函数，可单测）。
 *
 * 只覆盖会话正文里高频出现的语法：围栏代码块、标题、引用、无序/有序列表、
 * 分隔线、表格、段落；行内支持粗体、斜体、行内代码、链接。
 *
 * 设计目标：给 ArkUI 的 TextSpan 渲染提供「块 + 行内片段」结构，
 * 不追求完整 CommonMark 兼容（iOS/小程序端也是同样的裁剪取舍）。
 */

/** 反引号：用字符码构造，避免在源码里出现裸反引号导致工具链混淆。 */
const TICK: string = String.fromCharCode(96);

/** 会被当成「文件」渲染的扩展名（只用于识别 [文件名.xlsx] 这种方括号写法） */
const FILE_EXTS: string = '|doc|docx|docm|dot|dotx|wps|xls|xlsx|xlsm|csv|tsv|et|ppt|pptx|pptm|pot|potx|dps|pdf|ofd|txt|md|mdx|rst|rtf|html|htm|epub|mobi|key|pages|numbers|json|jsonl|yaml|yml|toml|xml|sql|db|sqlite|parquet|sh|bat|ps1|ets|ts|tsx|js|jsx|py|ipynb|java|kt|go|rs|c|cpp|h|hpp|cs|swift|rb|php|lua|vue|css|scss|png|jpg|jpeg|gif|webp|svg|bmp|tif|tiff|ico|heic|mp4|mov|avi|mkv|webm|mp3|wav|flac|aac|ogg|m4a|zip|rar|7z|tar|gz|bz2|xz|apk|aab|hap|hsp|ipa|exe|msi|dmg|iso|psd|ai|sketch|fig|xd|dwg|dxf|stl|obj|glb|gltf|ttf|otf|woff|woff2|';

/** 裸 URL 里遇到这些字符就结束（中文标点同样算结束） */
const URL_STOP: string = '，。；：！？、（）【】《》「」『』<>"`|';

/** URL 结尾允许被吃进来但要剥掉的标点 */
const URL_TAIL: string = '.,;:!?)]}。，；：！？）】》」';
export interface InlineSpan {
  text: string;
  /** plain | bold | italic | code | link */
  style: string;
  href: string;
}

export interface MarkdownBlock {
  /** paragraph | code | heading | quote | list | divider | table */
  kind: string;
  /** heading 级别（1..6）；其它为 0 */
  level: number;
  /** 代码块语言；其它为空串 */
  language: string;
  /** 正文（table 为空串） */
  text: string;
  /** image 块的图片地址（其它块为空串） */
  src: string;
  /** 行内片段（code 块为空） */
  spans: InlineSpan[];
  /** 有序列表序号；无序列表与其它块为 0 */
  index: number;
  headers: string[];
  rows: string[][];
}

/** 解析过程中的可变游标，避免闭包捕获。 */
class ParseCursor {
  index: number = 0;
  paragraph: string[] = [];
  quote: string[] = [];
}

export class MarkdownLite {
  /** 单块正文上限，避免极端文本撑爆单行渲染。 */
  static readonly BLOCK_TEXT_LIMIT: number = 8000;

  static emptyBlock(kind: string): MarkdownBlock {
    const block: MarkdownBlock = {
      kind: kind,
      level: 0,
      language: '',
      text: '',
      src: '',
      spans: [],
      index: 0,
      headers: [],
      rows: []
    };
    return block;
  }

  static parse(source: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    if (source.length === 0) {
      return blocks;
    }
    const lines: string[] = source.split('\n').map((line: string) => line.replace(/\r$/, ''));
    const cursor: ParseCursor = new ParseCursor();
    const fence: string = TICK + TICK + TICK;

    while (cursor.index < lines.length) {
      const trimmed: string = lines[cursor.index].trim();

      // 1) 围栏代码块
      if (trimmed.startsWith(fence)) {
        MarkdownLite.flush(blocks, cursor);
        const language: string = trimmed.substring(3).trim();
        const body: string[] = [];
        cursor.index++;
        while (cursor.index < lines.length && lines[cursor.index].trim().startsWith(fence) === false) {
          body.push(lines[cursor.index]);
          cursor.index++;
        }
        if (cursor.index < lines.length) {
          cursor.index++;
        }
        const block: MarkdownBlock = MarkdownLite.emptyBlock('code');
        block.language = language;
        block.text = body.join('\n');
        blocks.push(block);
        continue;
      }

      // 2) 空行：结束段落与引用
      if (trimmed.length === 0) {
        MarkdownLite.flush(blocks, cursor);
        cursor.index++;
        continue;
      }

      // 3) 分隔线
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
        MarkdownLite.flush(blocks, cursor);
        blocks.push(MarkdownLite.emptyBlock('divider'));
        cursor.index++;
        continue;
      }

      // 4) 标题
      const heading: number = MarkdownLite.headingLevel(trimmed);
      if (heading > 0) {
        MarkdownLite.flush(blocks, cursor);
        const block: MarkdownBlock = MarkdownLite.emptyBlock('heading');
        block.level = heading;
        block.text = trimmed.substring(heading).trim();
        block.spans = MarkdownLite.inline(block.text);
        blocks.push(block);
        cursor.index++;
        continue;
      }

      // 5) 引用
      if (trimmed.startsWith('>')) {
        if (cursor.paragraph.length > 0) {
          MarkdownLite.flushParagraph(blocks, cursor);
        }
        cursor.quote.push(trimmed.substring(1).trim());
        cursor.index++;
        continue;
      }
      if (cursor.quote.length > 0) {
        MarkdownLite.flushQuote(blocks, cursor);
      }

      // 6) 表格：当前行含竖线，下一行是分隔行
      if (trimmed.indexOf('|') >= 0 && cursor.index + 1 < lines.length
        && MarkdownLite.isTableDivider(lines[cursor.index + 1].trim())) {
        MarkdownLite.flushParagraph(blocks, cursor);
        const headers: string[] = MarkdownLite.splitRow(trimmed);
        cursor.index += 2;
        const rows: string[][] = [];
        while (cursor.index < lines.length && lines[cursor.index].trim().indexOf('|') >= 0) {
          rows.push(MarkdownLite.splitRow(lines[cursor.index].trim()));
          cursor.index++;
        }
        const block: MarkdownBlock = MarkdownLite.emptyBlock('table');
        block.headers = headers;
        block.rows = rows;
        blocks.push(block);
        continue;
      }

      // 7) 列表
      const marker: string = MarkdownLite.listMarker(trimmed);
      if (marker.length > 0) {
        MarkdownLite.flushParagraph(blocks, cursor);
        const ordered: boolean = marker !== '-';
        let itemIndex: number = 1;
        while (cursor.index < lines.length) {
          const current: string = lines[cursor.index].trim();
          const currentMarker: string = MarkdownLite.listMarker(current);
          if (currentMarker.length === 0) {
            break;
          }
          const offset: number = currentMarker === '-' ? 1 : currentMarker.length;
          const content: string = current.substring(offset).trim();
          const block: MarkdownBlock = MarkdownLite.emptyBlock('list');
          block.index = ordered ? itemIndex : 0;
          block.text = content;
          block.spans = MarkdownLite.inline(content);
          blocks.push(block);
          itemIndex++;
          cursor.index++;
        }
        continue;
      }

      // 7.5) 图片：整行只有 ![alt](src) 时作为图片块（对齐小程序 markdown.js 的 image 块）
      const imageSrc: string = MarkdownLite.imageSrc(trimmed);
      if (imageSrc.length > 0) {
        MarkdownLite.flushParagraph(blocks, cursor);
        const block: MarkdownBlock = MarkdownLite.emptyBlock('image');
        block.src = imageSrc;
        blocks.push(block);
        cursor.index++;
        continue;
      }

      // 8) 普通段落行
      cursor.paragraph.push(trimmed);
      cursor.index++;
    }
    MarkdownLite.flush(blocks, cursor);
    return blocks;
  }

  /** 整行图片语法 ![alt](src) → 返回 src；不是图片行返回空串（只认绝对地址，避免误判正文） */
  private static imageSrc(line: string): string {
    if (!line.startsWith('![')) {
      return '';
    }
    const close: number = line.indexOf('](');
    if (close < 0 || !line.endsWith(')')) {
      return '';
    }
    const src: string = line.substring(close + 2, line.length - 1).trim();
    // 绝对路径（/tmp/x.png 这类宿主机本地路径）也要识别成图片块：
    // 手机端访问不到宿主路径，但如果不识别，它会被当成「!alt 链接」渲染成蓝色文字。
    if (src.startsWith('http://') || src.startsWith('https://')
      || src.startsWith('file://') || src.startsWith('datashare://') || src.startsWith('/')) {
      return src;
    }
    return '';
  }

  private static flush(blocks: MarkdownBlock[], cursor: ParseCursor): void {
    MarkdownLite.flushParagraph(blocks, cursor);
    MarkdownLite.flushQuote(blocks, cursor);
  }

  private static flushParagraph(blocks: MarkdownBlock[], cursor: ParseCursor): void {
    if (cursor.paragraph.length === 0) {
      return;
    }
    const text: string = cursor.paragraph.join('\n').trim();
    cursor.paragraph = [];
    if (text.length === 0) {
      return;
    }
    const block: MarkdownBlock = MarkdownLite.emptyBlock('paragraph');
    block.text = text.length > MarkdownLite.BLOCK_TEXT_LIMIT ? text.substring(0, MarkdownLite.BLOCK_TEXT_LIMIT) : text;
    block.spans = MarkdownLite.inline(block.text);
    blocks.push(block);
  }

  private static flushQuote(blocks: MarkdownBlock[], cursor: ParseCursor): void {
    if (cursor.quote.length === 0) {
      return;
    }
    const text: string = cursor.quote.join('\n').trim();
    cursor.quote = [];
    if (text.length === 0) {
      return;
    }
    const block: MarkdownBlock = MarkdownLite.emptyBlock('quote');
    block.text = text;
    block.spans = MarkdownLite.inline(text);
    blocks.push(block);
  }

  static headingLevel(trimmed: string): number {
    let level: number = 0;
    while (level < trimmed.length && trimmed.charAt(level) === '#') {
      level++;
    }
    if (level === 0 || level > 6) {
      return 0;
    }
    if (trimmed.length <= level || trimmed.charAt(level) !== ' ') {
      return 0;
    }
    return level;
  }

  static isTableDivider(trimmed: string): boolean {
    if (trimmed.length === 0) {
      return false;
    }
    let dashes: number = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const c: string = trimmed.charAt(i);
      if (c === '-') {
        dashes++;
      } else if (c !== ':' && c !== '|' && c !== ' ') {
        return false;
      }
    }
    return dashes > 0;
  }

  static splitRow(trimmed: string): string[] {
    let value: string = trimmed;
    if (value.startsWith('|')) {
      value = value.substring(1);
    }
    if (value.endsWith('|')) {
      value = value.substring(0, value.length - 1);
    }
    return value.split('|').map((cell: string) => cell.trim());
  }

  /** 列表标记：无序返回 '-'，有序返回原文标记（如 '12.'），无标记返回空串。 */
  static listMarker(trimmed: string): string {
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ')) {
      return '-';
    }
    let digits: number = 0;
    while (digits < trimmed.length && trimmed.charAt(digits) >= '0' && trimmed.charAt(digits) <= '9') {
      digits++;
    }
    if (digits === 0 || digits > 9) {
      return '';
    }
    if (trimmed.length > digits + 1) {
      const separator: string = trimmed.charAt(digits);
      if ((separator === '.' || separator === ')') && trimmed.charAt(digits + 1) === ' ') {
        return trimmed.substring(0, digits + 1);
      }
    }
    return '';
  }

  /** 行内解析：行内代码 / 粗体 / 斜体 / 链接，按出现顺序切分。 */
  static inline(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    if (text.length === 0) {
      return spans;
    }
    let buffer: string = '';
    let index: number = 0;
    while (index < text.length) {
      const rest: string = text.substring(index);
      // 裸 URL（http/https）：桌面端会渲染成可点链接，这里同样当成 link
      if (rest.startsWith('http://') || rest.startsWith('https://')) {
        const urlEnd: number = MarkdownLite.urlEnd(rest);
        if (urlEnd > 0) {
          MarkdownLite.push(spans, buffer, 'plain', '');
          buffer = '';
          const url: string = rest.substring(0, urlEnd);
          MarkdownLite.push(spans, url, 'link', url);
          index += urlEnd;
          continue;
        }
      }
      if (rest.startsWith(TICK)) {
        const end: number = rest.indexOf(TICK, 1);
        if (end > 0) {
          MarkdownLite.push(spans, buffer, 'plain', '');
          buffer = '';
          MarkdownLite.push(spans, rest.substring(1, end), 'code', '');
          index += end + 1;
          continue;
        }
      }
      if (rest.startsWith('**')) {
        const end: number = rest.indexOf('**', 2);
        if (end > 0) {
          MarkdownLite.push(spans, buffer, 'plain', '');
          buffer = '';
          // 粗体里可能还嵌着链接（`**[文件名](路径)**` 是桌面端最常见的写法）：
          // 递归解析后整体标成 bold —— 之前直接整段塞成 bold 纯文本，包在里面的链接就点不开了。
          MarkdownLite.pushNested(spans, rest.substring(2, end), 'bold');
          index += end + 2;
          continue;
        }
      }
      if (rest.startsWith('*') && rest.startsWith('**') === false) {
        const end: number = rest.indexOf('*', 1);
        if (end > 0) {
          MarkdownLite.push(spans, buffer, 'plain', '');
          buffer = '';
          MarkdownLite.pushNested(spans, rest.substring(1, end), 'italic');
          index += end + 1;
          continue;
        }
      }
      if (rest.startsWith('[') || rest.startsWith('［')) {
        // 链接容错：`]` 与 `(` 之间允许空格，`]`、`(`、`)` 半角/全角都认
        let close: number = -1;
        for (let k = 1; k < rest.length; k++) {
          const ch: string = rest.charAt(k);
          if (ch === ']' || ch === '］') {
            close = k;
            break;
          }
        }
        if (close > 0) {
          let open: number = close + 1;
          while (open < rest.length && rest.charAt(open) === ' ') {
            open++;
          }
          const paren: string = open < rest.length ? rest.charAt(open) : '';
          if (paren === '(' || paren === '（') {
            let end: number = -1;
            for (let k = open + 1; k < rest.length; k++) {
              const ch: string = rest.charAt(k);
              if (ch === ')' || ch === '）') {
                end = k;
                break;
              }
              if (ch === '\n') {
                break;
              }
            }
            if (end > open) {
              const label: string = rest.substring(1, close);
              const href: string = rest.substring(open + 1, end);
              if (label.length > 0) {
                MarkdownLite.push(spans, buffer, 'plain', '');
                buffer = '';
                MarkdownLite.push(spans, label, 'link', href.length > 0 ? href : label);
                index += end + 1;
                continue;
              }
            }
          }
          // 只有方括号、内容是文件名：[报告.xlsx] —— 当文件链接
          const inner: string = rest.substring(1, close);
          if (MarkdownLite.looksLikeFileName(inner)) {
            MarkdownLite.push(spans, buffer, 'plain', '');
            buffer = '';
            MarkdownLite.push(spans, inner, 'link', inner);
            index += close + 1;
            continue;
          }
        }
      }
      buffer += text.charAt(index);
      index++;
    }
    MarkdownLite.push(spans, buffer, 'plain', '');
    // 裸的本地网页路径（不带 http/https）单独切成 htmlpath 片段：正文里按普通文字 + 背景卡片渲染
    // 只按「源码里真的写了链接」渲染可点：
    //   · `[文字](地址)` / `[文件名.xlsx]` → link
    //   · 裸文件名（哪怕加粗）→ 纯文字
    // 桌面端就是这样：正文里黑体的文件名是普通文字，能点的只有真正带了链接的；
    // 之前这里还会把裸文件名自动转成 link，结果和上面的「文档卡片」重复，还点得出预览。
    return MarkdownLite.splitLocalHtmlPaths(spans);
  }



  /** 是否像文件名（有已知扩展名、不是网址） */
  private static looksLikeFileName(value: string): boolean {
    const name: string = value.trim();
    if (name.length < 4 || name.length > 200) {
      return false;
    }
    if (name.indexOf('://') >= 0 || name.indexOf(' ') >= 0 || name.indexOf('/') >= 0) {
      return false;
    }
    const lower: string = name.toLowerCase();
    const dot: number = lower.lastIndexOf('.');
    if (dot <= 0 || dot === lower.length - 1) {
      return false;
    }
    const ext: string = lower.substring(dot + 1);
    return FILE_EXTS.indexOf('|' + ext + '|') >= 0;
  }

  /** 裸 URL 的结束位置：遇到空白或中英文标点就停（括号允许出现在 URL 里时按配对处理） */
  private static urlEnd(text: string): number {
    let i: number = 0;
    while (i < text.length) {
      const ch: string = text.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        break;
      }
      if (URL_STOP.indexOf(ch) >= 0) {
        break;
      }
      i++;
    }
    // 去掉结尾被吞进来的标点
    while (i > 0) {
      const last: string = text.charAt(i - 1);
      if (URL_TAIL.indexOf(last) >= 0) {
        i--;
      } else {
        break;
      }
    }
    return i;
  }

  /** 路径词边界：空白与常见中英文标点（ASCII 标点用 charCode 判断，避免转义） */
  private static isPathBoundary(ch: string): boolean {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      return true;
    }
    const code: number = ch.charCodeAt(0);
    if (code < 128) {
      return (code >= 33 && code <= 47) || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
    }
    return '、，。；：！？（）【】「」《》“”‘’'.indexOf(ch) >= 0;
  }

  /**
   * 把纯文本片段里的「裸本地网页路径」（结尾 .html/.htm/.xhtml、不含 http(s)://）切成 htmlpath 片段，
   * 让正文把它画成带底色的卡片，而不是蓝色链接。
   */
  private static splitLocalHtmlPaths(spans: InlineSpan[]): InlineSpan[] {
    const out: InlineSpan[] = [];
    for (let s = 0; s < spans.length; s++) {
      const span: InlineSpan = spans[s];
      if (span.style !== 'plain' || span.text.toLowerCase().indexOf('.htm') < 0) {
        out.push(span);
        continue;
      }
      const text: string = span.text;
      const lower: string = text.toLowerCase();
      let cursor: number = 0;
      let search: number = 0;
      while (search < lower.length) {
        const idx: number = lower.indexOf('.htm', search);
        if (idx < 0) {
          break;
        }
        search = idx + 4;
        let end: number = -1;
        if (lower.startsWith('.html', idx)) {
          end = idx + 5;
        } else if (lower.startsWith('.xhtml', idx)) {
          end = idx + 6;
        } else if (lower.startsWith('.htm', idx)) {
          end = idx + 4;
        }
        if (end < 0 || end <= cursor) {
          continue;
        }
        if (end < lower.length && !MarkdownLite.isPathBoundary(lower.charAt(end))) {
          continue;
        }
        let start: number = idx;
        while (start > cursor && !MarkdownLite.isPathBoundary(lower.charAt(start - 1))) {
          start--;
        }
        const token: string = text.substring(start, end);
        if (token.length === 0 || token.toLowerCase().indexOf('://') >= 0) {
          continue;
        }
        MarkdownLite.push(out, text.substring(cursor, start), 'plain', '');
        MarkdownLite.push(out, token, 'htmlpath', token);
        cursor = end;
      }
      MarkdownLite.push(out, text.substring(cursor), 'plain', '');
    }
    return out;
  }


  /**
   * 自动把正文里的文件（带扩展名的文件名 / 路径）识别成链接，对齐桌面端：
   * 这类文字在 dsh 端是可点卡片，手机端也必须可点。
   */
  private static autoLinkFiles(spans: InlineSpan[]): InlineSpan[] {
    const out: InlineSpan[] = [];
    for (const span of spans) {
      if (span.style !== 'plain') {
        out.push(span);
        continue;
      }
      MarkdownLite.splitFileTokens(span.text, out);
    }
    return out;
  }

  /** 按空白切词：是文件的词换成 link 片段，其余原样 */
  private static splitFileTokens(text: string, out: InlineSpan[]): void {
    let buffer: string = '';
    let word: string = '';
    for (let i = 0; i < text.length; i++) {
      const ch: string = text.charAt(i);
      const isSpace: boolean = ch === ' ' || ch === '\t' || ch === '\n';
      if (isSpace) {
        if (word.length > 0) {
          MarkdownLite.pushFileWord(word, out);
          word = '';
        }
        buffer += ch;
      } else {
        if (buffer.length > 0) {
          MarkdownLite.push(out, buffer, 'plain', '');
          buffer = '';
        }
        word += ch;
      }
    }
    if (word.length > 0) {
      MarkdownLite.pushFileWord(word, out);
    }
    MarkdownLite.push(out, buffer, 'plain', '');
  }

  /** 单个词：前后剥掉标点后若像文件，则输出 link */
  private static pushFileWord(word: string, out: InlineSpan[]): void {
    const lead: string = MarkdownLite.trimLead(word);
    const core: string = word.substring(lead.length);
    const body: string = MarkdownLite.trimTrail(core);
    const tail: string = core.substring(body.length);
    if (body.length > 0 && MarkdownLite.isFilePath(body)) {
      MarkdownLite.push(out, lead, 'plain', '');
      MarkdownLite.push(out, body, 'link', body);
      MarkdownLite.push(out, tail, 'plain', '');
      return;
    }
    MarkdownLite.push(out, word, 'plain', '');
  }

  /** 去掉开头的括号/引号 */
  private static trimLead(word: string): string {
    const marks: string = '([{【《「『"\'“（';
    let i: number = 0;
    while (i < word.length && marks.indexOf(word.charAt(i)) >= 0) {
      i++;
    }
    return word.substring(0, i);
  }

  /** 去掉结尾的标点（含中文），但保留路径里的符号 */
  private static trimTrail(core: string): string {
    const marks: string = '.,;:!?)]}>}】》」』"\'”，。；：！？、';
    let end: number = core.length;
    while (end > 0 && marks.indexOf(core.charAt(end - 1)) >= 0) {
      end--;
    }
    return core.substring(0, end);
  }

  /** 是否像文件：有已知扩展名（可带路径），或者是 http(s) 之外的本地路径 */
  private static isFilePath(value: string): boolean {
    const name: string = value.trim();
    if (name.length < 4 || name.length > 300) {
      return false;
    }
    if (name.indexOf('://') >= 0) {
      return false;
    }
    const lower: string = name.toLowerCase();
    const dot: number = lower.lastIndexOf('.');
    if (dot <= 0 || dot === lower.length - 1) {
      return false;
    }
    const ext: string = lower.substring(dot + 1);
    return FILE_EXTS.indexOf('|' + ext + '|') >= 0;
  }

  /**
   * 把被 `style`（bold / italic）包裹的内容递归解析后并入 spans：
   * link / code 片段保留自己的样式（否则粗体里的链接会退化成纯文字点不开），其余统一成 style。
   */
  private static pushNested(spans: InlineSpan[], inner: string, style: string): void {
    const nested: InlineSpan[] = MarkdownLite.inline(inner);
    for (const span of nested) {
      if (span.style === 'link' || span.style === 'code') {
        spans.push(span);
      } else {
        MarkdownLite.push(spans, span.text, style, span.href);
      }
    }
  }

  private static push(spans: InlineSpan[], value: string, style: string, href: string): void {
    if (value.length === 0) {
      return;
    }
    const span: InlineSpan = { text: value, style: style, href: href };
    spans.push(span);
  }

  /** 纯文本（复制用）：去掉 Markdown 标记。 */
  static plainText(source: string): string {
    let out: string = '';
    for (const span of MarkdownLite.inline(source)) {
      out += span.text;
    }
    return out;
  }
}
