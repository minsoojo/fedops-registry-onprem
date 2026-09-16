import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateLlmEnabledDto {
  @ApiProperty({ description: 'LLM 활성화 여부' })
  @IsBoolean()
  enabled: boolean;
}
