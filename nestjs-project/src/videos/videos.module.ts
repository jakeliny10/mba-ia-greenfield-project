import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigType } from '@nestjs/config';
import { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import { Video } from './entities/video.entity';
import { VIDEO_QUEUE } from './video.constants';
import { VideoStorageService } from './video-storage.service';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.forRootAsync({
      inject: [videoConfig.KEY],
      useFactory: (config: ConfigType<typeof videoConfig>) => ({
        connection: { host: config.redisHost, port: config.redisPort },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
  ],
  controllers: [VideosController],
  providers: [VideoStorageService, VideosService],
  exports: [VideoStorageService, VideosService],
})
export class VideosModule {}
