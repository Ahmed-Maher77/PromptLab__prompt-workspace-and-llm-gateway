import { IsArray, IsNotEmpty, IsOptional, IsString, IsObject, MaxLength } from 'class-validator';
import { PromptVariableDto, FewShotExampleDto } from './create-prompt.dto';

export class CreateVersionDto {
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

  // Optional metadata updates to parent prompt when saving version
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'name must not exceed 100 characters' })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'description must not exceed 1000 characters' })
  description?: string;

  @IsArray()
  @IsOptional()
  techniques?: string[];
}
