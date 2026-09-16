import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { RegistryListQueryDto } from '../../common/registry-list-query.dto';
import type { LlmSourceKind } from '../schemas/llm-registry.schema';

/**
 * LLM 목록 조회 쿼리 (architecture-v0.4.md §7.1).
 * 공통 파라미터에 LLM 전용 source 필터를 얹는다.
 */
export class ListLlmsQueryDto extends RegistryListQueryDto {
  @ApiPropertyOptional({
    description: '소스 종류 필터',
    enum: ['registry', 'huggingface'],
  })
  @IsIn(['registry', 'huggingface'])
  @IsOptional()
  source?: LlmSourceKind;
}
