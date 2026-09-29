import { VideoInvalidRangeException } from './video.errors';

export function parseVideoRange(
  value: string | undefined,
  size: number,
): { start: number; end: number; header: string } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size < 1) {
    throw new VideoInvalidRangeException(size);
  }
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  ) {
    throw new VideoInvalidRangeException(size);
  }
  const start = first === null ? Math.max(0, size - (last as number)) : first;
  const end =
    first === null
      ? size - 1
      : last === null
        ? size - 1
        : Math.min(last, size - 1);
  if (start >= size || start > end || (first === null && last === 0)) {
    throw new VideoInvalidRangeException(size);
  }
  return { start, end, header: `bytes=${start}-${end}` };
}
