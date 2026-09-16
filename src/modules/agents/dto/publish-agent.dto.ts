import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class PublishAgentDto {
  @ApiProperty({ description: 'AgentConfig.id (uuid)' })
  @IsUUID()
  agent_id: string;

  @ApiProperty({ description: 'AgentConfig.revision' })
  @IsInt()
  @Min(1)
  build_revision: number;

  @ApiProperty({ description: 'Agent 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Agent 설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description:
      'FedOps2-Client schemas/agent.py::AgentConfig JSON 전체 (opaque)',
  })
  @IsObject()
  config: Record<string, unknown>;

  @ApiProperty({ description: 'sha256(config bytes)' })
  @IsString()
  @IsNotEmpty()
  manifest_fingerprint: string;

  @ApiProperty({ description: 'Registry에 공개 여부' })
  @IsBoolean()
  is_public: boolean;
}
