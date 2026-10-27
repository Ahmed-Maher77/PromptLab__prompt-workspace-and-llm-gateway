import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsStringRecord } from '../../common/validators/is-string-record.validator';
import { FewShotExampleDto } from './create-prompt.dto';

export class PreviewPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32768, { message: 'templateBody must not exceed 32768 characters' })
  templateBody!: string;

  @IsOptional()
  @IsStringRecord({ maxKeys: 50, maxValueLength: 32768 })
  variables?: Record<string, string>;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FewShotExampleDto)
  examples?: FewShotExampleDto[];
}

export class RunPlaygroundDto {
  @IsString()
  @IsOptional()
  promptId?: string;

  @IsOptional()
  @IsInt({ message: 'versionNumber must be an integer' })
  @Min(1)
  versionNumber?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32768, { message: 'templateBody must not exceed 32768 characters' })
  templateBody!: string;

  @IsOptional()
  @IsStringRecord({ maxKeys: 50, maxValueLength: 32768 })
  variables?: Record<string, string>;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FewShotExampleDto)
  examples?: FewShotExampleDto[];

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9._:\/-]{1,128}$/, {
    message: 'Invalid model identifier format (must be 1-128 characters matching alphanumeric, ., _, :, /, -)',
  })
  model!: string;

  @IsOptional()
  @IsNumber({}, { message: 'temperature must be a number' })
  @Min(0, { message: 'temperature must be between 0 and 2' })
  @Max(2, { message: 'temperature must be between 0 and 2' })
  temperature?: number;

  @IsOptional()
  @IsInt({ message: 'maxTokens must be an integer' })
  @Min(1, { message: 'maxTokens must be between 1 and 32768' })
  @Max(32768, { message: 'maxTokens must be between 1 and 32768' })
  maxTokens?: number;
}
