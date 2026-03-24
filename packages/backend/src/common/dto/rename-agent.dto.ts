import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';

export class RenameAgentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 _-]+$/, {
    message: 'Agent name must contain only letters, numbers, spaces, dashes, and underscores',
  })
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(10000) // 10 seconds in milliseconds
  request_timeout_ms?: number;
}
