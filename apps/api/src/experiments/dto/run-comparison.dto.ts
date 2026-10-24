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
  Validate,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import RE2 = require('re2');

@ValidatorConstraint({ name: 'isValidCriterionPattern', async: false })
export class IsValidCriterionPatternConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const obj = args.object as EvaluationCriterionDto;
    if (obj?.type === 'regex') {
      if (typeof value !== 'string' || value.trim().length === 0) {
        return false;
      }
      if (value.trim().length > 256) {
        return false;
      }
      try {
        new RE2(value.trim(), 'i');
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    const obj = args.object as EvaluationCriterionDto;
    if (obj?.type === 'regex') {
      const val = args.value;
      if (!val || typeof val !== 'string' || val.trim().length === 0) {
        return 'expectedValue is required when criterion type is regex';
      }
      if (val.trim().length > 256) {
        return 'Regex pattern exceeds maximum allowed length of 256 characters';
      }
      return 'Invalid regular expression for regex evaluation criterion (must be valid linear-time RE2 syntax)';
    }
    return 'Invalid expectedValue';
  }
}

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

  @ValidateIf((o: EvaluationCriterionDto) => o.type === 'regex' || o.expectedValue != null)
  @IsString()
  @MaxLength(4096, { message: 'expectedValue must not exceed 4096 characters' })
  @Validate(IsValidCriterionPatternConstraint)
  expectedValue?: string;
}

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
