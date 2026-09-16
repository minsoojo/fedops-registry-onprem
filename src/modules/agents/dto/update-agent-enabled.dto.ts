import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAgentEnabledDto {
  @ApiProperty({ description: 'Agent 활성화 여부' })
  @IsBoolean()
  enabled: boolean;
}
