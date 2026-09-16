import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateLlmVisibilityDto {
  @ApiProperty({ description: 'Registry에 공개 여부' })
  @IsBoolean()
  is_public: boolean;
}
