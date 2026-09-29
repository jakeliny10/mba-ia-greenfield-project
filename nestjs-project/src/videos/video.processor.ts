import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { VIDEO_JOB, VIDEO_QUEUE } from './video.constants';
import { VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';
import { VideoProcessingService } from './video-processing.service';

@Processor(VIDEO_QUEUE, { concurrency: 1 })
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly videos: VideosService,
    private readonly processing: VideoProcessingService,
  ) {
    super();
  }

  async process(job: Job<{ videoId: string }>): Promise<void> {
    if (job.name !== VIDEO_JOB) throw new Error('Job desconhecido');
    const video = await this.videos.findForProcessing(job.data.videoId);
    if (!video || video.status === VideoStatus.READY) return;
    if (video.status === VideoStatus.ERROR) return;
    await this.videos.markProcessing(video);
    const result = await this.processing.process(video);
    await this.videos.markReady(video, result);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ videoId: string }> | undefined, error: Error) {
    this.logger.error(`Falha no processamento: ${error.message}`);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.videos.markError(job.data.videoId, 'PROCESSING_FAILED');
    }
  }
}
