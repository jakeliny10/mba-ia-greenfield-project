import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import videoConfig from '../config/video.config';
import { envValidationSchema } from '../config/env.validation';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessor } from './video.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, videoConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.name,
        entities: [User, Channel, Video],
        synchronize: false,
      }),
    }),
    VideosModule,
  ],
  providers: [VideoProcessingService, VideoProcessor],
})
export class VideoWorkerModule {}
