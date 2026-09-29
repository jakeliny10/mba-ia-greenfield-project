import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { VideoInvalidRangeException } from './video.errors';

@Catch(VideoInvalidRangeException)
export class VideoRangeExceptionFilter implements ExceptionFilter<VideoInvalidRangeException> {
  catch(exception: VideoInvalidRangeException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(416)
      .setHeader('Content-Range', `bytes */${exception.size}`)
      .json({
        statusCode: 416,
        error: exception.errorCode,
        message: exception.message,
      });
  }
}
