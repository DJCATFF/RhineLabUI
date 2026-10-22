import { HttpException } from '@nestjs/common';

export const PDF_SIGNATURE = Buffer.from('%PDF-');

/** A PDF original must carry the %PDF- header at offset 0, not merely somewhere in the file. */
export function isPdfSignature(header: Buffer) {
  return header.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

export class FileRangeError extends HttpException {
  constructor(readonly size: number) {
    super('Requested range is not satisfiable', 416);
  }
}

export function fileRange(header: string | undefined, size: number) {
  if (!header) return { offset: 0, length: size, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new FileRangeError(size);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size ||
    (!match[1] && Number(match[2]) === 0)
  )
    throw new FileRangeError(size);
  return { offset: start, length: end - start + 1, partial: true };
}

export function fileDisposition(name: string, inline: boolean) {
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="document${inline ? '.pdf' : ''}"; filename*=UTF-8''${encoded}`;
}
