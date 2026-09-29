import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { CreateVideoDto } from './dto/create-video.dto';
import { PART_SIZE, VIDEO_JOB, VIDEO_QUEUE } from './video.constants';
import { VideoStorageService } from './video-storage.service';
import {
  VideoAuthenticationException,
  VideoForbiddenException,
  VideoInvalidStateException,
  VideoInvalidUploadException,
  VideoNotFoundException,
  VideoQueueUnavailableException,
  VideoStorageUnavailableException,
} from './video.errors';
import { parseVideoRange } from './video-range';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    private readonly storage: VideoStorageService,
    @InjectQueue(VIDEO_QUEUE) private readonly queue: Queue,
  ) {}

  async create(userId: string, dto: CreateVideoDto) {
    const channel = await this.channels.findOneBy({ user_id: userId });
    if (!channel) throw new VideoForbiddenException();
    const id = randomUUID();
    const publicId = randomUUID();
    const key = `videos/${channel.id}/${id}/original`;
    let uploadId: string;
    try {
      uploadId = await this.storage.startMultipart(key, dto.contentType);
    } catch {
      throw new VideoStorageUnavailableException();
    }
    try {
      await this.videos.save(
        this.videos.create({
          id,
          channel_id: channel.id,
          public_id: publicId,
          title: dto.title,
          status: VideoStatus.DRAFT,
          storage_key: key,
          upload_id: uploadId,
          expected_size: dto.sizeBytes,
          content_type: dto.contentType,
        }),
      );
    } catch (error) {
      await this.storage.abortMultipart(key, uploadId);
      throw error;
    }
    return {
      publicId,
      status: VideoStatus.DRAFT,
      partSize: PART_SIZE,
      partCount: Math.ceil(dto.sizeBytes / PART_SIZE),
    };
  }

  async signPart(
    publicId: string,
    userId: string,
    partNumber: number,
  ): Promise<{ url: string; expiresIn: number }> {
    const video = await this.getOwned(publicId, userId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new VideoInvalidStateException();
    }
    if (partNumber > Math.ceil(video.expected_size / PART_SIZE)) {
      throw new VideoInvalidUploadException();
    }
    try {
      const url = await this.storage.signPart(
        video.storage_key,
        video.upload_id,
        partNumber,
      );
      return { url, expiresIn: 900 };
    } catch {
      throw new VideoStorageUnavailableException();
    }
  }

  async complete(publicId: string, userId: string) {
    const video = await this.getOwned(publicId, userId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      if (
        video.status === VideoStatus.PROCESSING ||
        video.status === VideoStatus.READY
      ) {
        return { publicId, status: video.status };
      }
      throw new VideoInvalidStateException();
    }
    try {
      await this.storage.completeMultipart(
        video.storage_key,
        video.upload_id,
        video.expected_size,
        PART_SIZE,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /Partes ausentes|Tamanho/.test(error.message)
      ) {
        throw new VideoInvalidUploadException();
      }
      throw new VideoStorageUnavailableException();
    }
    video.size_bytes = video.expected_size;
    await this.videos.save(video);
    try {
      await this.queue.add(
        VIDEO_JOB,
        { videoId: video.id },
        {
          jobId: `video-${video.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    } catch {
      throw new VideoQueueUnavailableException();
    }
    return { publicId, status: video.status };
  }

  async abort(publicId: string, userId: string): Promise<void> {
    const video = await this.getOwned(publicId, userId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new VideoInvalidStateException();
    }
    try {
      await this.storage.abortMultipart(video.storage_key, video.upload_id);
    } catch {
      throw new VideoStorageUnavailableException();
    }
    await this.videos.remove(video);
  }

  async metadata(publicId: string, userId?: string) {
    const video = await this.findByPublicId(publicId);
    if (video.status !== VideoStatus.READY) {
      if (!userId) throw new VideoAuthenticationException();
      await this.assertOwner(video, userId);
    }
    return {
      publicId: video.public_id,
      channelId: video.channel_id,
      title: video.title,
      status: video.status,
      sizeBytes: video.size_bytes,
      contentType: video.content_type,
      durationMs: video.duration_ms,
      width: video.width,
      height: video.height,
      videoCodec: video.video_codec,
      containerFormat: video.container_format,
      createdAt: video.created_at,
    };
  }

  async media(publicId: string, range?: string, thumbnail = false) {
    const video = await this.findByPublicId(publicId);
    if (video.status !== VideoStatus.READY) throw new VideoNotFoundException();
    const key = thumbnail ? video.thumbnail_key : video.storage_key;
    if (!key) throw new VideoNotFoundException();
    const size = thumbnail
      ? await this.storage.objectSizeOrNull(key)
      : video.size_bytes;
    if (size === null) throw new VideoNotFoundException();
    const parsed = thumbnail ? null : parseVideoRange(range, size);
    const object = await this.storage.getObject(key, parsed?.header);
    return {
      ...object,
      partial: parsed !== null,
      contentRange: parsed
        ? `bytes ${parsed.start}-${parsed.end}/${size}`
        : undefined,
      totalSize: size,
      contentType: thumbnail ? 'image/jpeg' : video.content_type,
      title: video.title,
    };
  }

  async findForProcessing(videoId: string): Promise<Video | null> {
    return this.videos.findOneBy({ id: videoId });
  }

  async markProcessing(video: Video): Promise<void> {
    if (video.status === VideoStatus.DRAFT) {
      await this.videos.update(
        { id: video.id, status: VideoStatus.DRAFT },
        { status: VideoStatus.PROCESSING },
      );
    }
  }

  async markReady(
    video: Video,
    data: {
      thumbnailKey: string;
      durationMs: number;
      width: number;
      height: number;
      videoCodec: string;
      containerFormat: string;
    },
  ): Promise<void> {
    await this.videos.update(video.id, {
      status: VideoStatus.READY,
      thumbnail_key: data.thumbnailKey,
      duration_ms: data.durationMs,
      width: data.width,
      height: data.height,
      video_codec: data.videoCodec,
      container_format: data.containerFormat,
      processing_error: null,
    });
  }

  async markError(videoId: string, reason: string): Promise<void> {
    await this.videos.update(
      { id: videoId, status: VideoStatus.PROCESSING },
      { status: VideoStatus.ERROR, processing_error: reason.slice(0, 200) },
    );
  }

  private async findByPublicId(publicId: string): Promise<Video> {
    const video = await this.videos.findOneBy({ public_id: publicId });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private async getOwned(publicId: string, userId: string): Promise<Video> {
    const video = await this.findByPublicId(publicId);
    await this.assertOwner(video, userId);
    return video;
  }

  private async assertOwner(video: Video, userId: string): Promise<void> {
    const channel = await this.channels.findOneBy({ user_id: userId });
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoForbiddenException();
    }
  }
}
