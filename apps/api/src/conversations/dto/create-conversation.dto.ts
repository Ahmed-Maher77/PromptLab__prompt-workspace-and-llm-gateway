import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'title must not exceed 200 characters' })
  title?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  provider!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9._:\/-]{1,128}$/, {
    message: 'Invalid model identifier format (must be 1-128 characters matching alphanumeric, ., _, :, /, -)',
  })
  model!: string;

  @IsString()
  @IsOptional()
  @MaxLength(32768, { message: 'systemPrompt must not exceed 32768 characters' })
  systemPrompt?: string;

  @IsOptional()
  @IsInt({ message: 'contextBudget must be an integer' })
  @Min(512, { message: 'contextBudget must be at least 512' })
  @Max(1048576, { message: 'contextBudget must not exceed 1048576' })
  contextBudget?: number;
}
