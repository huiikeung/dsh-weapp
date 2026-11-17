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

      // 8) 普通段落行
      cursor.paragraph.push(trimmed);
      cursor.index++;
    }
    MarkdownLite.flush(blocks, cursor);
    return blocks;
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
          MarkdownLite.push(spans, rest.substring(2, end), 'bold', '');
          index += end + 2;
          continue;
        }
      }
      if (rest.startsWith('*') && rest.startsWith('**') === false) {
        const end: number = rest.indexOf('*', 1);
        if (end > 0) {
          MarkdownLite.push(spans, buffer, 'plain', '');
          buffer = '';
          MarkdownLite.push(spans, rest.substring(1, end), 'italic', '');
          index += end + 1;
          continue;
        }
      }
      if (rest.startsWith('[')) {
        const close: number = rest.indexOf('](', 1);
        if (close > 0) {
          const end: number = rest.indexOf(')', close + 2);
          if (end > 0) {
            MarkdownLite.push(spans, buffer, 'plain', '');
            buffer = '';
            MarkdownLite.push(spans, rest.substring(1, close), 'link', rest.substring(close + 2, end));
            index += end + 1;
            continue;
          }
        }
      }
      buffer += text.charAt(index);
      index++;
    }
    MarkdownLite.push(spans, buffer, 'plain', '');
    return spans;
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
