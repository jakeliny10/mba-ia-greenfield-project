import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

const bigintNumber = {
  to: (value: number) => value,
  from: (value: string) => Number(value),
};

@Entity('videos')
@Index(['channel_id', 'status'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'uuid', unique: true })
  public_id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 500, unique: true })
  storage_key: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  upload_id: string | null;

  @Column({ type: 'bigint', transformer: bigintNumber })
  expected_size: number;

  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber })
  size_bytes: number | null;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  @Column({ type: 'integer', nullable: true })
  duration_ms: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  video_codec: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  container_format: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  processing_error: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
