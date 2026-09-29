import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

type CreatedVideo = {
  publicId: string;
  status: VideoStatus;
  partSize: number;
  partCount: number;
};

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let database: DataSource;
  let jwt: JwtService;
  const file = readFileSync(join(__dirname, 'fixtures', 'short-video.mp4'));

  async function putSignedPart(signedUrl: string): Promise<number> {
    const url = new URL(signedUrl);
    return new Promise((resolve, reject) => {
      const upload = httpRequest(
        {
          hostname: 'minio',
          port: 9000,
          method: 'PUT',
          path: `${url.pathname}${url.search}`,
          headers: { Host: url.host, 'Content-Length': file.length },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
          response.on('error', reject);
        },
      );
      upload.on('error', reject);
      upload.end(file);
    });
  }

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
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    database = module.get(DataSource);
    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(database);
  });

  async function createUser(email: string): Promise<string> {
    const user = await database.getRepository(User).save({
      email,
      password: 'unused-in-video-test',
      is_confirmed: true,
    });
    await database.getRepository(Channel).save({
      user_id: user.id,
      name: email,
      nickname: email.split('@')[0],
    });
    return jwt.sign({ sub: user.id, email });
  }

  it('uploads, processes, streams and downloads a video', async () => {
    const ownerToken = await createUser('video-owner@example.com');
    const otherToken = await createUser('video-other@example.com');
    const createdResponse = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Vídeo de teste',
        sizeBytes: file.length,
        contentType: 'video/mp4',
      })
      .expect(201);
    const created = createdResponse.body as CreatedVideo;
    expect(created.status).toBe(VideoStatus.DRAFT);
    expect(created.partCount).toBe(1);
    expect(created.partSize).toBe(64 * 1024 * 1024);

    const video = await database.getRepository(Video).findOneByOrFail({
      public_id: created.publicId,
    });
    expect(video.upload_id).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/videos/${created.publicId}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/videos/${created.publicId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    const draftResponse = await request(app.getHttpServer())
      .get(`/videos/${created.publicId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect((draftResponse.body as { status: string }).status).toBe('draft');

    const signedResponse = await request(app.getHttpServer())
      .post(`/videos/${created.publicId}/upload/parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partNumber: 1 })
      .expect(201);
    const signedUrl = (signedResponse.body as { url: string }).url;
    expect(signedUrl).toContain('X-Amz-Signature');
    expect(await putSignedPart(signedUrl)).toBe(200);

    await request(app.getHttpServer())
      .post(`/videos/${created.publicId}/upload/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(202);

    let ready: Video | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await database.getRepository(Video).findOneBy({ id: video.id });
      if (
        ready?.status === VideoStatus.READY ||
        ready?.status === VideoStatus.ERROR
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(ready?.status).toBe(VideoStatus.READY);
    expect(ready?.duration_ms).toBeGreaterThan(0);
    expect(ready?.thumbnail_key).toBeTruthy();

    const repeatedCompletion = await request(app.getHttpServer())
      .post(`/videos/${created.publicId}/upload/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(202);
    expect((repeatedCompletion.body as { status: string }).status).toBe(
      'ready',
    );

    const metadata = await request(app.getHttpServer())
      .get(`/videos/${created.publicId}`)
      .expect(200);
    expect((metadata.body as { status: string }).status).toBe('ready');

    const stream = await request(app.getHttpServer())
      .get(`/videos/${created.publicId}/stream`)
      .set('Range', 'bytes=0-9')
      .expect(206);
    expect(stream.headers['content-range']).toBe(`bytes 0-9/${file.length}`);
    expect(stream.headers['content-length']).toBe('10');
    expect(stream.body as Buffer).toEqual(file.subarray(0, 10));

    const invalidRange = await request(app.getHttpServer())
      .get(`/videos/${created.publicId}/stream`)
      .set('Range', `bytes=${file.length}-`)
      .expect(416);
    expect(invalidRange.headers['content-range']).toBe(
      `bytes */${file.length}`,
    );

    const download = await request(app.getHttpServer())
      .get(`/videos/${created.publicId}/download`)
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-length']).toBe(file.length.toString());
    expect(download.body as Buffer).toEqual(file);

    const thumbnail = await request(app.getHttpServer())
      .get(`/videos/${created.publicId}/thumbnail`)
      .expect(200);
    expect(thumbnail.headers['content-type']).toContain('image/jpeg');
    expect(Number(thumbnail.headers['content-length'])).toBeGreaterThan(0);
  }, 45_000);

  it('accepts the 10 GiB limit as 160 direct-upload parts', async () => {
    const token = await createUser('large-video@example.com');
    const maxBytes = 10 * 1024 * 1024 * 1024;
    await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Grande demais',
        sizeBytes: maxBytes + 1,
        contentType: 'video/mp4',
      })
      .expect(400);

    const response = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Vídeo grande',
        sizeBytes: maxBytes,
        contentType: 'video/mp4',
      })
      .expect(201);
    const created = response.body as CreatedVideo;
    expect(created.partCount).toBe(160);

    await request(app.getHttpServer())
      .post(`/videos/${created.publicId}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partNumber: 160 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/videos/${created.publicId}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partNumber: 161 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/videos/${created.publicId}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/videos/${created.publicId}/upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(
      await database
        .getRepository(Video)
        .findOneBy({ public_id: created.publicId }),
    ).toBeNull();
  });
});
