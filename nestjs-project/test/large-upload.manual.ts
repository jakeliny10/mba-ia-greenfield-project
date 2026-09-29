import { request as httpRequest } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStorageService } from '../src/videos/video-storage.service';

describe('Upload físico de 10 GiB (manual)', () => {
  let app: INestApplication<App>;
  let database: DataSource;
  let storage: VideoStorageService;
  let publicId: string | undefined;
  let videoId: string | undefined;
  let channelId: string | undefined;
  let userId: string | undefined;
  const total = 10 * 1024 * 1024 * 1024;
  const partSize = 64 * 1024 * 1024;
  const body = Buffer.alloc(partSize);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    database = module.get(DataSource);
    storage = module.get(VideoStorageService);
  });

  afterAll(async () => {
    try {
      if (videoId) {
        const video = await database
          .getRepository(Video)
          .findOneBy({ id: videoId });
        if (video) {
          if (video.upload_id && video.size_bytes === null) {
            await storage.abortMultipart(video.storage_key, video.upload_id);
          }
          if (video.size_bytes !== null) {
            const client = new S3Client({
              endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
              region: process.env.S3_REGION || 'us-east-1',
              forcePathStyle: true,
              credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY!,
                secretAccessKey: process.env.S3_SECRET_KEY!,
              },
            });
            try {
              await client.send(
                new DeleteObjectCommand({
                  Bucket: process.env.S3_BUCKET || 'streamtube',
                  Key: video.storage_key,
                }),
              );
            } finally {
              client.destroy();
            }
          }
          await database.getRepository(Video).delete(video.id);
        }
      }
      if (channelId) await database.getRepository(Channel).delete(channelId);
      if (userId) await database.getRepository(User).delete(userId);
    } finally {
      await app.close();
    }
  });

  it(
    'transfere e conclui 160 partes de 64 MiB diretamente no storage',
    async () => {
      const email = `large-${Date.now()}@example.com`;
      const user = await database
        .getRepository(User)
        .save({ email, password: 'manual-test', is_confirmed: true });
      userId = user.id;
      const channel = await database.getRepository(Channel).save({
        user_id: user.id,
        name: 'Teste grande',
        nickname: `large${Date.now()}`,
      });
      channelId = channel.id;
      const token = app.get(JwtService).sign({ sub: user.id, email });
      const created = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Teste físico de 10 GiB',
          sizeBytes: total,
          contentType: 'video/mp4',
        })
        .expect(201);
      publicId = (created.body as { publicId: string }).publicId;
      const video = await database
        .getRepository(Video)
        .findOneByOrFail({ public_id: publicId });
      videoId = video.id;
      expect((created.body as { partCount: number }).partCount).toBe(160);

      for (let partNumber = 1; partNumber <= 160; partNumber++) {
        const signed = await request(app.getHttpServer())
          .post(`/videos/${publicId}/upload/parts`)
          .set('Authorization', `Bearer ${token}`)
          .send({ partNumber })
          .expect(201);
        const url = new URL((signed.body as { url: string }).url);
        const status = await new Promise<number>((resolve, reject) => {
          const upload = httpRequest(
            {
              hostname: 'minio',
              port: 9000,
              method: 'PUT',
              path: `${url.pathname}${url.search}`,
              headers: { Host: url.host, 'Content-Length': body.length },
            },
            (response) => {
              response.resume();
              response.on('end', () => resolve(response.statusCode ?? 0));
              response.on('error', reject);
            },
          );
          upload.on('error', reject);
          upload.end(body);
        });
        expect(status).toBe(200);
        if (partNumber % 20 === 0)
          process.stdout.write(`Partes concluídas: ${partNumber}/160\n`);
      }

      await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);
      const completed = await database
        .getRepository(Video)
        .findOneByOrFail({ id: videoId });
      expect(completed.size_bytes).toBe(total);
      expect(await storage.objectSizeOrNull(completed.storage_key)).toBe(total);
    },
    20 * 60 * 1000,
  );
});
