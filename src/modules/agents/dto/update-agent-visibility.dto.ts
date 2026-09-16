import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAgentVisibilityDto {
  @ApiProperty({ description: 'Registry에 공개 여부' })
  @IsBoolean()
  is_public: boolean;
}
