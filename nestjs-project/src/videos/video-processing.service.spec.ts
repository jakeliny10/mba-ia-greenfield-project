import { parseProbe } from './video-processing.service';

describe('parseProbe', () => {
  it('extracts video metadata and converts duration to milliseconds', () => {
    expect(
      parseProbe(
        JSON.stringify({
          format: { duration: '1.234', format_name: 'mp4' },
          streams: [
            { codec_type: 'audio', codec_name: 'aac' },
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1920,
              height: 1080,
            },
          ],
        }),
      ),
    ).toEqual({
      durationMs: 1234,
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      containerFormat: 'mp4',
    });
  });

  it('rejects files without a valid video stream', () => {
    expect(() =>
      parseProbe(
        JSON.stringify({
          format: { duration: '2.0' },
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
        }),
      ),
    ).toThrow('Vídeo sem metadados válidos');
  });

  it('rejects missing or non-positive duration', () => {
    expect(() =>
      parseProbe(
        JSON.stringify({
          format: { duration: '0' },
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 320,
              height: 180,
            },
          ],
        }),
      ),
    ).toThrow('Vídeo sem metadados válidos');
  });
});
