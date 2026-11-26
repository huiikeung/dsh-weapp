/**
 * 附件的共享视觉定义：扩展名 → 底色 / 徽标文字 / 大小文案。
 * 输入条的整条附件卡（ComposerFileCard）和消息气泡里的附件卡（FileAttachmentCard）共用同一份配色，
 * 同一个文件在「待发送」和「已发送」两侧看起来一致。
 */

const EXT_COLORS: Map<string, string> = new Map<string, string>([
  ['pdf', '#E5484D'],
  ['doc', '#2E6BE6'], ['docx', '#2E6BE6'], ['rtf', '#2E6BE6'],
  ['xls', '#1F9D55'], ['xlsx', '#1F9D55'], ['csv', '#1F9D55'],
  ['ppt', '#E8730C'], ['pptx', '#E8730C'],
  ['zip', '#8250DF'], ['rar', '#8250DF'], ['7z', '#8250DF'],
  ['md', '#6E7681'], ['txt', '#6E7681'], ['log', '#6E7681'],
  ['json', '#6E7681'], ['xml', '#6E7681'], ['yaml', '#6E7681'], ['yml', '#6E7681']
]);

/** 小写扩展名（不含点），没有扩展名时返回空串 */
export function attachmentExt(name: string): string {
  const dot: number = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
}

/** 文件类型徽标底色 */
export function attachmentExtColor(name: string): string {
  const color: string | undefined = EXT_COLORS.get(attachmentExt(name));
  return color !== undefined ? color : '#6E7681';
}

/** 徽标文字：PDF / DOCX / XLSX…，最多 4 个字符 */
export function attachmentExtLabel(name: string): string {
  const ext: string = attachmentExt(name);
  return ext.length > 0 ? ext.substring(0, 4).toUpperCase() : '文件';
}

/** 字节数 → 7.3MB / 812KB / 640B（与截图里「PDF 7.3MB」同一写法） */
export function attachmentSizeText(bytes: number): string {
  if (bytes < 1024) {
    return bytes + 'B';
  }
  if (bytes < 1024 * 1024) {
    return Math.round(bytes / 1024) + 'KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
