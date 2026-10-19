import { IsArray, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { FewShotExampleDto } from './create-prompt.dto';

export class PreviewPromptDto {
  @IsString()
  @IsNotEmpty()
  templateBody!: string;

  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;

  @IsArray()
  @IsOptional()
  examples?: FewShotExampleDto[];
}

export class RunPlaygroundDto {
  @IsString()
  @IsOptional()
  promptId?: string;

  @IsOptional()
  versionNumber?: number;

  @IsString()
  @IsNotEmpty()
  templateBody!: string;

  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;

  @IsArray()
  @IsOptional()
  examples?: FewShotExampleDto[];

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsOptional()
  temperature?: number;

  @IsOptional()
  maxTokens?: number;
}
