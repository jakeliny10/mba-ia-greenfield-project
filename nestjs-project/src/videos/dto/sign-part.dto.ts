import { IsInt, Max, Min } from 'class-validator';

export class SignPartDto {
  @IsInt()
  @Min(1)
  @Max(160)
  partNumber: number;
}
