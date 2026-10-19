import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PreviewCompactionDto {
  @IsNumber()
  @IsOptional()
  @Min(1)
  compactThroughSequence?: number;
}

export class ApplyCompactionDto {
  @IsString()
  @IsNotEmpty()
  summary: string;

  @IsArray()
  @IsString({ each: true })
  retainedFacts: string[];

  @IsNumber()
  @Min(1)
  compactedThroughSequence: number;
}
