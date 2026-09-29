import { VideoInvalidRangeException } from './video.errors';
import { parseVideoRange } from './video-range';

describe('parseVideoRange', () => {
  it('returns null when no range is requested', () => {
    expect(parseVideoRange(undefined, 100)).toBeNull();
  });

  it.each([
    ['bytes=10-19', { start: 10, end: 19, header: 'bytes=10-19' }],
    ['bytes=90-', { start: 90, end: 99, header: 'bytes=90-99' }],
    ['bytes=-10', { start: 90, end: 99, header: 'bytes=90-99' }],
    ['bytes=-200', { start: 0, end: 99, header: 'bytes=0-99' }],
    ['bytes=90-200', { start: 90, end: 99, header: 'bytes=90-99' }],
  ])('normalizes %s', (input, expected) => {
    expect(parseVideoRange(input, 100)).toEqual(expected);
  });

  it.each([
    'bytes=100-',
    'bytes=20-10',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,3-4',
    'bytes=9007199254740992-',
  ])('rejects invalid range %s', (input) => {
    expect(() => parseVideoRange(input, 100)).toThrow(
      VideoInvalidRangeException,
    );
  });
});
