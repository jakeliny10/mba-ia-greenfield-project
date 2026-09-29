import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

describe('Video entity (integration)', () => {
  let database: DataSource;
  let channelId: string;

  beforeAll(async () => {
    database = createTestDataSource([User, Channel, Video], {
      synchronize: false,
    });
    await database.initialize();
  });

  afterAll(async () => {
    await database.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(database);
    const user = await database.getRepository(User).save({
      email: 'video-entity@example.com',
      password: 'unused-in-test',
      is_confirmed: true,
    });
    const channel = await database.getRepository(Channel).save({
      user_id: user.id,
      name: 'Vídeos',
      nickname: 'video-entity',
    });
    channelId = channel.id;
  });

  it('persists a draft linked to its channel and preserves the 10 GiB size', async () => {
    const video = await database.getRepository(Video).save({
      channel_id: channelId,
      public_id: randomUUID(),
      title: 'Vídeo grande',
      storage_key: `videos/${randomUUID()}/original`,
      expected_size: 10 * 1024 * 1024 * 1024,
      content_type: 'video/mp4',
    });

    const stored = await database.getRepository(Video).findOneByOrFail({
      id: video.id,
    });
    expect(stored.status).toBe(VideoStatus.DRAFT);
    expect(stored.channel_id).toBe(channelId);
    expect(stored.expected_size).toBe(10 * 1024 * 1024 * 1024);
  });

  it('enforces the channel foreign key and public URL uniqueness', async () => {
    const publicId = randomUUID();
    await database.getRepository(Video).save({
      channel_id: channelId,
      public_id: publicId,
      title: 'Primeiro',
      storage_key: `videos/${randomUUID()}/original`,
      expected_size: 1,
      content_type: 'video/mp4',
    });

    await expect(
      database.getRepository(Video).save({
        channel_id: channelId,
        public_id: publicId,
        title: 'Duplicado',
        storage_key: `videos/${randomUUID()}/original`,
        expected_size: 1,
        content_type: 'video/mp4',
      }),
    ).rejects.toThrow(QueryFailedError);

    await expect(
      database.getRepository(Video).save({
        channel_id: randomUUID(),
        public_id: randomUUID(),
        title: 'Sem canal',
        storage_key: `videos/${randomUUID()}/original`,
        expected_size: 1,
        content_type: 'video/mp4',
      }),
    ).rejects.toThrow(QueryFailedError);
  });
});
