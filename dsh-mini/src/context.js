// Context governance, miniature dsh-spill-policy: oversized tool results are NOT
// handed to the model in full. The model receives head+tail with an omission marker
// and the absolute path of a spill file holding the complete text.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { truncateMiddle } from './util.js';

const MARKER = '\n… [{n} chars omitted — full output saved to {path}]\n';

/**
 * @param {string} text raw tool output
 * @param {{spillDir: string, spillName: string, maxInlineChars?: number, headChars?: number, tailChars?: number}} opts
 * @returns {{text: string, spilled: boolean, spillPath?: string}}
 */
export async function inlineToolResult(text, opts) {
  const maxInline = opts.maxInlineChars ?? 12000;
  if (text.length <= maxInline) return { text, spilled: false };

  await fsp.mkdir(opts.spillDir, { recursive: true });
  const spillPath = path.join(opts.spillDir, opts.spillName);
  await fsp.writeFile(spillPath, text, 'utf8');

  const head = opts.headChars ?? 9000;
  const tail = opts.tailChars ?? 2000;
  const { text: shrunk } = truncateMiddle(text, head, tail, MARKER.replace('{path}', spillPath));
  return { text: shrunk, spilled: true, spillPath };
}
