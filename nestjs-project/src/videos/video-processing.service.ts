import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { Video } from './entities/video.entity';
import { VideoStorageService } from './video-storage.service';

type ProbeResult = {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
  }>;
};

export function parseProbe(raw: string): {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  containerFormat: string;
} {
  const data = JSON.parse(raw) as ProbeResult;
  const stream = data.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(data.format?.duration ?? stream?.duration);
  if (
    !stream?.width ||
    !stream.height ||
    !stream.codec_name ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error('Vídeo sem metadados válidos');
  }
  return {
    durationMs: Math.round(duration * 1000),
    width: stream.width,
    height: stream.height,
    videoCodec: stream.codec_name,
    containerFormat: data.format?.format_name ?? 'unknown',
  };
}

function runTool(
  binary: string,
  args: string[],
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxBytes) {
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (length > maxBytes) {
        reject(new Error('Saída de processamento excedeu limite'));
      } else if (code !== 0) {
        reject(new Error(`${binary} falhou com código ${code}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
  });
}

@Injectable()
export class VideoProcessingService {
  constructor(private readonly storage: VideoStorageService) {}

  async process(video: Video): Promise<{
    thumbnailKey: string;
    durationMs: number;
    width: number;
    height: number;
    videoCodec: string;
    containerFormat: string;
  }> {
    const url = await this.storage.signedInternalRead(video.storage_key);
    const raw = await runTool(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', url],
      1024 * 1024,
    );
    const metadata = parseProbe(raw.toString('utf8'));
    const seek = metadata.durationMs > 1000 ? '1' : '0';
    const jpeg = await runTool(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-i',
        url,
        '-ss',
        seek,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      5 * 1024 * 1024,
    );
    if (jpeg.length === 0) throw new Error('Thumbnail vazia');
    const thumbnailKey = `thumbnails/${video.id}.jpg`;
    await this.storage.putThumbnail(thumbnailKey, jpeg);
    return { ...metadata, thumbnailKey };
  }
}
