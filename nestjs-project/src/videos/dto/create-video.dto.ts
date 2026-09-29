import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_VIDEO_BYTES } from '../video.constants';

export class CreateVideoDto {
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  title: string;

  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_BYTES)
  sizeBytes: number;

  @IsString()
  @MaxLength(100)
  @Matches(/^video\/[a-z0-9.+-]+$/i)
  contentType: string;
}
