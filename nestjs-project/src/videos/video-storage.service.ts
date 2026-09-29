import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import videoConfig from '../config/video.config';

@Injectable()
export class VideoStorageService implements OnModuleDestroy {
  private readonly internal: S3Client;
  private readonly publicSigner: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(videoConfig.KEY)
    config: ConfigType<typeof videoConfig>,
  ) {
    const shared = {
      region: config.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    };
    this.internal = new S3Client({ ...shared, endpoint: config.s3Endpoint });
    this.publicSigner = new S3Client({
      ...shared,
      endpoint: config.s3PublicEndpoint,
    });
    this.bucket = config.bucket;
  }

  onModuleDestroy(): void {
    this.internal.destroy();
    this.publicSigner.destroy();
  }

  async startMultipart(key: string, contentType: string): Promise<string> {
    const response = await this.internal.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!response.UploadId) throw new Error('S3 não retornou UploadId');
    return response.UploadId;
  }

  async signPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicSigner,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: 900 },
    );
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    expectedSize: number,
    partSize: number,
  ): Promise<void> {
    const existing = await this.objectSizeOrNull(key);
    if (existing !== null) {
      if (existing !== expectedSize)
        throw new Error('Tamanho do objeto divergente');
      return;
    }
    const listed = await this.internal.send(
      new ListPartsCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
    const parts = [...(listed.Parts ?? [])].sort(
      (a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0),
    );
    const count = Math.ceil(expectedSize / partSize);
    if (
      parts.length !== count ||
      parts.some(
        (part, index) =>
          part.PartNumber !== index + 1 ||
          !part.ETag ||
          part.Size !==
            (index === count - 1 ? expectedSize - partSize * index : partSize),
      )
    ) {
      throw new Error('Partes ausentes ou tamanho divergente');
    }
    await this.internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            ETag: part.ETag,
            PartNumber: part.PartNumber,
          })),
        },
      }),
    );
    const size = await this.objectSizeOrNull(key);
    if (size !== expectedSize) throw new Error('Tamanho final divergente');
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.internal.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async objectSizeOrNull(key: string): Promise<number | null> {
    try {
      const result = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return result.ContentLength ?? null;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'NotFound' || error.name === 'NoSuchKey')
      ) {
        return null;
      }
      throw error;
    }
  }

  async signedInternalRead(key: string): Promise<string> {
    return getSignedUrl(
      this.internal,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );
  }

  async putThumbnail(key: string, jpeg: Buffer): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: jpeg,
        ContentType: 'image/jpeg',
        ContentLength: jpeg.length,
      }),
    );
  }

  async getObject(
    key: string,
    range?: string,
  ): Promise<{
    body: Readable;
    length: number;
    contentRange?: string;
    contentType?: string;
  }> {
    const result = await this.internal.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range,
      }),
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error('S3 não retornou stream Node');
    }
    return {
      body: result.Body,
      length: result.ContentLength ?? 0,
      contentRange: result.ContentRange,
      contentType: result.ContentType,
    };
  }
}
