import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Query parameters for GET /api/prompts. Declared explicitly so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) accepts them; undeclared parameters are rejected.
 */
export class ListPromptsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'search must not exceed 200 characters' })
  search?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,50}$/, { message: 'technique must be a technique identifier' })
  technique?: string;
}
