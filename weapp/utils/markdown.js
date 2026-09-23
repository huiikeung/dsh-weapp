// 轻量 Markdown → 结构化块，供小程序渲染。
// 覆盖 iOS 对话流实际出现的语法：标题、段落、围栏代码块、行内代码、
// 粗体、斜体、链接、列表、分割线、引用。不追求完整 CommonMark。

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内语法 → HTML（rich-text 可渲染的白名单标签）。 */
function inlineHtml(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, function (_m, code) {
    return '<code class="md-inline-code">' + code + '</code>';
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(（])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, label, href) {
    return '<a href="' + href + '">' + label + '</a>';
  });
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

/**
 * 解析 Markdown 文本为块数组：
 * { type: 'heading', level, html }
 * { type: 'code', lang, text }
 * { type: 'quote', html }
 * { type: 'list', ordered, items: [html] }
 * { type: 'hr' }
 * { type: 'para', html }
 */
function parse(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = null;
  let quote = null;
  let i = 0;

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: 'para', html: inlineHtml(paragraph.join('\n')).replace(/\n/g, '<br/>') });
      paragraph = [];
    }
  }
  function flushList() {
    if (list) {
      blocks.push(list);
      list = null;
    }
  }
  function flushQuote() {
    if (quote) {
      blocks.push({ type: 'quote', html: inlineHtml(quote.join('\n')).replace(/\n/g, '<br/>') });
      quote = null;
    }
  }
  function flushAll() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    const fence = line.match(/^\s*```\s*([A-Za-z0-9+#\-_]*)/);
    if (fence) {
      flushAll();
      const lang = fence[1] || '';
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结尾 ```
      blocks.push({ type: 'code', lang: lang, text: code.join('\n') });
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      blocks.push({ type: 'heading', level: heading[1].length, html: inlineHtml(heading[2]) });
      i += 1;
      continue;
    }

    // 分割线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      if (!quote) quote = [];
      quote.push(line.replace(/^\s*>\s?/, ''));
      i += 1;
      continue;
    }

    // 列表
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { type: 'list', ordered: isOrdered, items: [] };
      }
      list.items.push(inlineHtml(bullet ? bullet[1] : ordered[2]));
      i += 1;
      continue;
    }

    // 空行
    if (!line.trim()) {
      flushAll();
      i += 1;
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
    i += 1;
  }
  flushAll();
  return blocks;
}

module.exports = { parse, inlineHtml, escapeHtml };
