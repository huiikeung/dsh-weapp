/**
 * 文件类型判定与图标/配色 —— 逐项对齐 dsh-mobile 的 shared/facade/FileIconKind.kt +
 * FileIconCatalog.kt（图标资源取自 Design/file-icons/svg，即 Untitled UI 文件图标，
 * 与 dsh 安卓端 FileTypeIcon 用的是同一套矢量图）。
 *
 * 用途：工作模式「已编辑 N 个文件」卡片与交付文件卡片，让 Word/PPT/Excel/PDF 等
 * 文档的图标、底色与 dsh 端完全一致。
 */

/** 类型主色（与 FileIconKind.colorRgb 一致） */
const PDF_RGB: number[] = [0xD9, 0x2D, 0x20];
const DOCUMENT_RGB: number[] = [0x15, 0x5E, 0xEF];
const TEXT_RGB: number[] = [0x34, 0x40, 0x54];
const SHEET_RGB: number[] = [0x07, 0x94, 0x55];
const SLIDES_RGB: number[] = [0xE6, 0x2E, 0x05];
const CODE_RGB: number[] = [0x44, 0x4C, 0xE7];
const IMAGE_RGB: number[] = [0x7F, 0x56, 0xD9];
const MEDIA_RGB: number[] = [0xDD, 0x25, 0x90];
const VIDEO_RGB: number[] = [0x15, 0x5E, 0xEF];
const ARCHIVE_RGB: number[] = [0x34, 0x40, 0x54];
const UNKNOWN_RGB: number[] = [0x34, 0x40, 0x54];

export const FILE_KIND_PDF: string = 'pdf';
export const FILE_KIND_DOC: string = 'doc';
export const FILE_KIND_DOCX: string = 'docx';
export const FILE_KIND_TXT: string = 'txt';
export const FILE_KIND_MD: string = 'md';
export const FILE_KIND_XLS: string = 'xls';
export const FILE_KIND_XLSX: string = 'xlsx';
export const FILE_KIND_CSV: string = 'csv';
export const FILE_KIND_PPT: string = 'ppt';
export const FILE_KIND_PPTX: string = 'pptx';
export const FILE_KIND_HTML: string = 'html';
export const FILE_KIND_CODE: string = 'code';
export const FILE_KIND_IMAGE: string = 'image';
export const FILE_KIND_SVG: string = 'svg';
export const FILE_KIND_JPG: string = 'jpg';
export const FILE_KIND_GIF: string = 'gif';
export const FILE_KIND_WEBP: string = 'webp';
export const FILE_KIND_AUDIO: string = 'audio';
export const FILE_KIND_VIDEO: string = 'video';
export const FILE_KIND_ARCHIVE: string = 'archive';
export const FILE_KIND_PACKAGE: string = 'package';
export const FILE_KIND_BINARY: string = 'binary';
export const FILE_KIND_UNKNOWN: string = 'unknown';

/** 按文件名（可带 mediaType）判定类型：先看特殊文件名，再看扩展名，最后看 mediaType */
export function fileKindOf(name: string, mediaType: string = ''): string {
  const normalized: string = name.replace(/\\/g, '/');
  const base: string = normalized.substring(normalized.lastIndexOf('/') + 1).trim().toLowerCase();
  if (base === '.env' || base.indexOf('.env.') === 0) {
    return FILE_KIND_CODE;
  }
  if (base.endsWith('.gradle.kts') || base === 'makefile' || base === 'cmakelists.txt') {
    return FILE_KIND_CODE;
  }
  if (base === 'dockerfile' || base.indexOf('dockerfile.') === 0) {
    return FILE_KIND_CODE;
  }
  if (base === 'readme' || base === 'license' || base === 'licence' || base === 'notice') {
    return FILE_KIND_TXT;
  }
  const dot: number = base.lastIndexOf('.');
  const ext: string = dot > 0 ? base.substring(dot + 1) : '';
  if (ext === 'pdf') {
    return FILE_KIND_PDF;
  }
  if (ext === 'doc') {
    return FILE_KIND_DOC;
  }
  if (ext === 'docx' || ext === 'odt' || ext === 'epub' || ext === 'rtf') {
    return FILE_KIND_DOCX;
  }
  if (ext === 'txt' || ext === 'text') {
    return FILE_KIND_TXT;
  }
  if (ext === 'md' || ext === 'markdown') {
    return FILE_KIND_MD;
  }
  if (ext === 'xls') {
    return FILE_KIND_XLS;
  }
  if (ext === 'xlsx' || ext === 'ods') {
    return FILE_KIND_XLSX;
  }
  if (ext === 'csv' || ext === 'tsv') {
    return FILE_KIND_CSV;
  }
  if (ext === 'ppt') {
    return FILE_KIND_PPT;
  }
  if (ext === 'pptx' || ext === 'odp') {
    return FILE_KIND_PPTX;
  }
  if (ext === 'svg') {
    return FILE_KIND_SVG;
  }
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'heic') {
    return FILE_KIND_JPG;
  }
  if (ext === 'gif') {
    return FILE_KIND_GIF;
  }
  if (ext === 'webp') {
    return FILE_KIND_WEBP;
  }
  if (ext === 'png' || ext === 'bmp') {
    return FILE_KIND_IMAGE;
  }
  if (ext === 'mp3' || ext === 'wav' || ext === 'm4a' || ext === 'aac' || ext === 'flac') {
    return FILE_KIND_AUDIO;
  }
  if (ext === 'mp4' || ext === 'mov' || ext === 'mkv' || ext === 'webm') {
    return FILE_KIND_VIDEO;
  }
  if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz') {
    return FILE_KIND_ARCHIVE;
  }
  if (ext === 'apk' || ext === 'ipa' || ext === 'hap') {
    return FILE_KIND_PACKAGE;
  }
  if (ext === 'jar' || ext === 'bin' || ext === 'so' || ext === 'dylib') {
    return FILE_KIND_BINARY;
  }
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
    return FILE_KIND_HTML;
  }
  const codeExtensions: string = ' c cpp cc cxx h hpp csharp java kt swift m py ipynb js jsx ts tsx '
    + 'html css scss less vue svelte go rs dart rb php sh ps1 sql json jsonl yaml yml xml toml ini '
    + 'conf env gradle cmake make bat ets ';
  if (codeExtensions.indexOf(' ' + ext + ' ') >= 0) {
    return FILE_KIND_CODE;
  }
  const mime: string = mediaType.split(';')[0].trim().toLowerCase();
  if (mime === 'application/pdf') {
    return FILE_KIND_PDF;
  }
  if (mime.indexOf('image/') === 0) {
    return FILE_KIND_IMAGE;
  }
  if (mime.indexOf('audio/') === 0) {
    return FILE_KIND_AUDIO;
  }
  if (mime.indexOf('video/') === 0) {
    return FILE_KIND_VIDEO;
  }
  if (mime.indexOf('text/') === 0) {
    return FILE_KIND_TXT;
  }
  if (mime === 'application/octet-stream') {
    return FILE_KIND_BINARY;
  }
  return ext.length === 0 ? FILE_KIND_UNKNOWN : FILE_KIND_UNKNOWN;
}

/** 类型主色（rgb 0..255） */
export function fileKindRgb(kind: string): number[] {
  if (kind === FILE_KIND_PDF) {
    return PDF_RGB;
  }
  if (kind === FILE_KIND_DOC || kind === FILE_KIND_DOCX) {
    return DOCUMENT_RGB;
  }
  if (kind === FILE_KIND_TXT || kind === FILE_KIND_MD) {
    return TEXT_RGB;
  }
  if (kind === FILE_KIND_XLS || kind === FILE_KIND_XLSX || kind === FILE_KIND_CSV) {
    return SHEET_RGB;
  }
  if (kind === FILE_KIND_PPT || kind === FILE_KIND_PPTX) {
    return SLIDES_RGB;
  }
  if (kind === FILE_KIND_CODE || kind === FILE_KIND_PACKAGE) {
    return CODE_RGB;
  }
  if (kind === FILE_KIND_IMAGE || kind === FILE_KIND_SVG || kind === FILE_KIND_JPG
    || kind === FILE_KIND_GIF || kind === FILE_KIND_WEBP) {
    return IMAGE_RGB;
  }
  if (kind === FILE_KIND_AUDIO) {
    return MEDIA_RGB;
  }
  if (kind === FILE_KIND_VIDEO) {
    return VIDEO_RGB;
  }
  if (kind === FILE_KIND_ARCHIVE) {
    return ARCHIVE_RGB;
  }
  return UNKNOWN_RGB;
}

/** 卡片底色：类型色与表面色按 8%（浅）/16%（深）混合（对齐 cardBackgroundRgb） */
export function fileCardColor(kind: string, isDark: boolean): string {
  const rgb: number[] = fileKindRgb(kind);
  const amount: number = isDark ? 0.16 : 0.08;
  const surface: number[] = isDark ? [0x1C, 0x1C, 0x1E] : [0xFF, 0xFF, 0xFF];
  const r: number = Math.round(rgb[0] * amount + surface[0] * (1 - amount));
  const g: number = Math.round(rgb[1] * amount + surface[1] * (1 - amount));
  const b: number = Math.round(rgb[2] * amount + surface[2] * (1 - amount));
  return 'rgb(' + r.toString() + ',' + g.toString() + ',' + b.toString() + ')';
}

/** 全彩图标资源（Untitled UI 文件图标，与 dsh 端同一套矢量图，不加 tint） */
export function fileKindIcon(kind: string): Resource {
  if (kind === FILE_KIND_PDF) {
    return $r('app.media.ficon_pdf');
  }
  if (kind === FILE_KIND_DOC) {
    return $r('app.media.ficon_doc');
  }
  if (kind === FILE_KIND_DOCX) {
    return $r('app.media.ficon_docx');
  }
  if (kind === FILE_KIND_TXT) {
    return $r('app.media.ficon_txt');
  }
  if (kind === FILE_KIND_MD) {
    return $r('app.media.ficon_md');
  }
  if (kind === FILE_KIND_XLS) {
    return $r('app.media.ficon_xls');
  }
  if (kind === FILE_KIND_XLSX) {
    return $r('app.media.ficon_xlsx');
  }
  if (kind === FILE_KIND_CSV) {
    return $r('app.media.ficon_csv');
  }
  if (kind === FILE_KIND_PPT) {
    return $r('app.media.ficon_ppt');
  }
  if (kind === FILE_KIND_PPTX) {
    return $r('app.media.ficon_pptx');
  }
  if (kind === FILE_KIND_HTML) {
    return $r('app.media.ficon_html');
  }
  if (kind === FILE_KIND_IMAGE) {
    return $r('app.media.ficon_image');
  }
  if (kind === FILE_KIND_SVG) {
    return $r('app.media.ficon_svg');
  }
  if (kind === FILE_KIND_JPG) {
    return $r('app.media.ficon_jpg');
  }
  if (kind === FILE_KIND_GIF) {
    return $r('app.media.ficon_gif');
  }
  if (kind === FILE_KIND_WEBP) {
    return $r('app.media.ficon_webp');
  }
  if (kind === FILE_KIND_AUDIO) {
    return $r('app.media.ficon_audio');
  }
  if (kind === FILE_KIND_VIDEO) {
    return $r('app.media.ficon_video');
  }
  if (kind === FILE_KIND_ARCHIVE) {
    return $r('app.media.ficon_archive');
  }
  if (kind === FILE_KIND_PACKAGE) {
    return $r('app.media.ficon_package');
  }
  if (kind === FILE_KIND_BINARY) {
    return $r('app.media.ficon_binary');
  }
  if (kind === FILE_KIND_CODE) {
    return $r('app.media.ficon_code');
  }
  if (kind === FILE_KIND_UNKNOWN) {
    return $r('app.media.ficon_unknown');
  }
  return $r('app.media.ficon_document');
}

/**
 * 卡片副标题清洗：去掉末尾括号里的展开清单（对齐 FileCardDescription.summary）。
 * 例：「示例项目文档（含概览、分工、计划）」→「示例项目文档」
 */
export function fileCardSummary(description: string): string {
  const text: string = description.trim().replace(/\s+/g, ' ');
  if (text.length === 0) {
    return '';
  }
  const candidate: string = text.replace(/[。.；; ]+$/, '');
  if (!(candidate.endsWith('）') || candidate.endsWith(')'))) {
    return text;
  }
  const closing: string[] = [];
  for (let index = candidate.length - 1; index >= 0; index--) {
    const character: string = candidate.charAt(index);
    if (character === '）' || character === ')') {
      closing.push(character);
      continue;
    }
    if (character === '（' || character === '(') {
      const expected: string = character === '(' ? ')' : '）';
      if (closing.length === 0 || closing[closing.length - 1] !== expected) {
        return text;
      }
      closing.pop();
      if (closing.length === 0) {
        const details: string = candidate.substring(index + 1, candidate.length - 1);
        if (details.indexOf('/') >= 0 || details.indexOf('／') >= 0 || details.indexOf('、') >= 0
          || details.indexOf(',') >= 0 || details.indexOf('，') >= 0 || details.indexOf(';') >= 0
          || details.indexOf('；') >= 0) {
          return candidate.substring(0, index).trim();
        }
        return text;
      }
    }
  }
  return text;
}
