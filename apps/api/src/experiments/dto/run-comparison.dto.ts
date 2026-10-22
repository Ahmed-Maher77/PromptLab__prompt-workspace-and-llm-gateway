import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SlotConfigDto {
  @IsString()
  @IsOptional()
  promptId?: string;

  @IsString()
  @IsOptional()
  promptVersionId?: string;

  @IsNumber()
  @IsOptional()
  versionNumber?: number;

  @IsString()
  @IsOptional()
  @MaxLength(32768, { message: 'templateBody must not exceed 32768 characters' })
  templateBody?: string;

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

export class EvaluationCriterionDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['contains_text', 'regex', 'json_validity', 'max_length', 'manual'], {
    message: 'Invalid evaluation criterion type (allowed: contains_text, regex, json_validity, max_length, manual)',
  })
  type!: 'contains_text' | 'regex' | 'json_validity' | 'max_length' | 'manual';

  @IsString()
  @IsOptional()
  @MaxLength(4096, { message: 'expectedValue must not exceed 4096 characters' })
  expectedValue?: string;
}

import { Type } from 'class-transformer';

export class RunComparisonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150, { message: 'name must not exceed 150 characters' })
  name!: string;

  @IsObject()
  commonInput!: Record<string, string>;

  @ValidateNested()
  @Type(() => SlotConfigDto)
  slotA!: SlotConfigDto;

  @ValidateNested()
  @Type(() => SlotConfigDto)
  slotB!: SlotConfigDto;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EvaluationCriterionDto)
  evaluationCriteria?: EvaluationCriterionDto[];

  @IsBoolean()
  @IsOptional()
  saveExperiment?: boolean;
}

export class RateExperimentDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['A', 'B'], { message: 'slot must be either A or B' })
  slot!: 'A' | 'B';

  @IsInt({ message: 'rating must be an integer between 1 and 5' })
  @Min(1, { message: 'rating must be between 1 and 5' })
  @Max(5, { message: 'rating must be between 1 and 5' })
  rating!: number; // 1 to 5

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'notes must not exceed 2000 characters' })
  notes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CriterionScoreDto)
  criteriaScores?: CriterionScoreDto[];
}

export class CriterionScoreDto {
  @IsString()
  @IsNotEmpty()
  criterionId!: string;

  @IsBoolean()
  passed!: boolean;
}
