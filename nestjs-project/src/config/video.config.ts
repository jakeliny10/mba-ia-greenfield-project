import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  s3Endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000',
  s3Region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET || 'streamtube',
  accessKey: process.env.S3_ACCESS_KEY!,
  secretKey: process.env.S3_SECRET_KEY!,
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: Number(process.env.REDIS_PORT || 6379),
}));
