import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateToolEnabledDto {
  @ApiProperty({ description: 'Tool 활성화 여부' })
  @IsBoolean()
  enabled: boolean;
}
