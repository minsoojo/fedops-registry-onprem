import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Agent Config 조립(resolve) 요청 DTO.
 *
 * 필드 모양(camelCase, 문자열 `modelVersion` 라벨)은 Registry의 다른 API(snake_case)와
 * 다르다 — 이건 실수가 아니라 연구실이 확정한 Agent Config 저장 형식(2026-08-08
 * 결정)을 그대로 받기 위함이다. 내부적으로는 tool_id/llm_id + version_label로 변환해
 * ToolsService/LlmsService를 조회한다.
 */
export class ResolveLlmRefDto {
  @ApiProperty({
    description:
      'llm-registry 엔트리의 실제 소스(정보 표시용 — 조회 조건에는 안 쓰인다)',
    enum: ['registry', 'huggingface'],
  })
  @IsIn(['registry', 'huggingface'])
  source: 'registry' | 'huggingface';

  @ApiProperty({ description: 'llm-registry의 llm_id' })
  @IsString()
  @IsNotEmpty()
  modelId: string;

  @ApiProperty({
    description: '발행 시 저장한 표시용 버전 라벨(예: "q4-k-m")',
  })
  @IsString()
  @IsNotEmpty()
  modelVersion: string;
}

export class ResolveToolRefDto {
  @ApiProperty({ description: 'tool-registry의 tool_id' })
  @IsString()
  @IsNotEmpty()
  toolId: string;

  @ApiProperty({
    description: '발행 시 저장한 표시용 버전 라벨(예: "federated-v1")',
  })
  @IsString()
  @IsNotEmpty()
  modelVersion: string;
}

export class ResolveAgentConfigDto {
  @ApiProperty({ type: ResolveLlmRefDto })
  @ValidateNested()
  @Type(() => ResolveLlmRefDto)
  llm: ResolveLlmRefDto;

  @ApiProperty({ type: [ResolveToolRefDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolveToolRefDto)
  tools: ResolveToolRefDto[];
}
