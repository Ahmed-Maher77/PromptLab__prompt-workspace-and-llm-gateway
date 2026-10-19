import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

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
  templateBody?: string;

  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsNumber()
  @IsOptional()
  temperature?: number;

  @IsNumber()
  @IsOptional()
  maxTokens?: number;
}

export class EvaluationCriterionDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: 'contains_text' | 'regex' | 'json_validity' | 'max_length' | 'manual';

  @IsString()
  @IsOptional()
  expectedValue?: string;
}

export class RunComparisonDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  commonInput!: Record<string, string>;

  @IsObject()
  slotA!: SlotConfigDto;

  @IsObject()
  slotB!: SlotConfigDto;

  @IsArray()
  @IsOptional()
  evaluationCriteria?: EvaluationCriterionDto[];

  @IsBoolean()
  @IsOptional()
  saveExperiment?: boolean;
}

export class RateExperimentDto {
  @IsString()
  @IsNotEmpty()
  slot!: 'A' | 'B';

  @IsNumber()
  rating!: number; // 1 to 5

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  criteriaScores?: Array<{ criterionId: string; passed: boolean }>;
}
