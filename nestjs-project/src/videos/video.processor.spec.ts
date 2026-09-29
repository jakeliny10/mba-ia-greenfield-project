import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Video, VideoStatus } from './entities/video.entity';
import { VIDEO_JOB } from './video.constants';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessor } from './video.processor';
import { VideosService } from './videos.service';

describe('VideoProcessor', () => {
  const video = { id: 'video-id', status: VideoStatus.DRAFT } as Video;
  const output = {
    thumbnailKey: 'thumbnails/video-id.jpg',
    durationMs: 1000,
    width: 64,
    height: 64,
    videoCodec: 'mpeg4',
    containerFormat: 'mp4',
  };
  const videos = {
    findForProcessing: jest.fn(),
    markProcessing: jest.fn(),
    markReady: jest.fn(),
    markError: jest.fn(),
  };
  const processing = { process: jest.fn() };
  const processor = new VideoProcessor(
    videos as unknown as VideosService,
    processing as unknown as VideoProcessingService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transitions a draft to ready after processing', async () => {
    videos.findForProcessing.mockResolvedValue(video);
    processing.process.mockResolvedValue(output);

    await processor.process({
      name: VIDEO_JOB,
      data: { videoId: video.id },
    } as Job<{ videoId: string }>);

    expect(videos.markProcessing).toHaveBeenCalledWith(video);
    expect(processing.process).toHaveBeenCalledWith(video);
    expect(videos.markReady).toHaveBeenCalledWith(video, output);
  });

  it('does not process an already ready video again', async () => {
    videos.findForProcessing.mockResolvedValue({
      ...video,
      status: VideoStatus.READY,
    });

    await processor.process({
      name: VIDEO_JOB,
      data: { videoId: video.id },
    } as Job<{ videoId: string }>);

    expect(processing.process).not.toHaveBeenCalled();
    expect(videos.markReady).not.toHaveBeenCalled();
  });

  it('records an error only after the final failed attempt', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const job = {
      data: { videoId: video.id },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as Job<{ videoId: string }>;

    await processor.onFailed(job, new Error('falha transitória'));
    expect(videos.markError).not.toHaveBeenCalled();

    job.attemptsMade = 3;
    await processor.onFailed(job, new Error('falha final'));
    expect(videos.markError).toHaveBeenCalledWith(
      video.id,
      'PROCESSING_FAILED',
    );
    log.mockRestore();
  });
});
