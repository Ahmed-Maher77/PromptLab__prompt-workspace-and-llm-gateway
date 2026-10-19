import { IsArray, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';

export class PromptVariableDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  required?: boolean;

  @IsString()
  @IsOptional()
  defaultValue?: string;
}

export class FewShotExampleDto {
  @IsString()
  @IsNotEmpty()
  input!: string;

  @IsString()
  @IsNotEmpty()
  output!: string;
}

export class CreatePromptDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  techniques?: string[]; // e.g. ['zero-shot', 'few-shot', 'rtf', 'structured-output', 'custom']

  @IsString()
  @IsNotEmpty()
  templateBody!: string;

  @IsArray()
  @IsOptional()
  variables?: PromptVariableDto[];

  @IsArray()
  @IsOptional()
  examples?: FewShotExampleDto[];

  @IsObject()
  @IsOptional()
  outputSchema?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  modelDefaults?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}
