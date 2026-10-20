import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32768, { message: 'content must not exceed 32768 characters' })
  content!: string;
}
