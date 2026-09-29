import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from './videos/video-worker.module';

async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(VideoWorkerModule);
}

void bootstrap();
