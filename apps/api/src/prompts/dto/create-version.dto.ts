import { IsArray, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { PromptVariableDto, FewShotExampleDto } from './create-prompt.dto';

export class CreateVersionDto {
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

  // Optional metadata updates to parent prompt when saving version
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  techniques?: string[];
}
