import { IsArray, IsNotEmpty, IsOptional, IsString, IsObject, MaxLength } from 'class-validator';

export class PromptVariableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  required?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  defaultValue?: string;
}

export class FewShotExampleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  input!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  output!: string;
}

export class CreatePromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'name must not exceed 100 characters' })
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'description must not exceed 1000 characters' })
  description?: string;

  @IsArray()
  @IsOptional()
  techniques?: string[]; // e.g. ['zero-shot', 'few-shot', 'rtf', 'structured-output', 'custom']

  @IsString()
  @IsNotEmpty()
  @MaxLength(32768, { message: 'templateBody must not exceed 32768 characters' })
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
