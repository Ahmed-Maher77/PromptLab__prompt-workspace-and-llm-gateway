import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class PreviewCompactionDto {
  @IsOptional()
  @IsInt({ message: 'compactThroughSequence must be an integer' })
  @Min(1)
  compactThroughSequence?: number;
}

export class ApplyCompactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16384, { message: 'summary must not exceed 16384 characters' })
  summary!: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true, message: 'each retained fact must not exceed 1000 characters' })
  retainedFacts!: string[];

  @IsInt({ message: 'compactedThroughSequence must be an integer' })
  @Min(1)
  compactedThroughSequence!: number;
}
