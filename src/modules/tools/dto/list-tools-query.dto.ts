import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { RegistryListQueryDto } from '../../common/registry-list-query.dto';
import type { ToolFramework } from '../schemas/tool-registry.schema';

/**
 * Tool 목록 조회 쿼리 (architecture-v0.4.md §7.1).
 * 공통 파라미터(search/page/limit/publicOnly)에 Tool 전용 tags/framework를 얹는다.
 */
export class ListToolsQueryDto extends RegistryListQueryDto {
  @ApiPropertyOptional({
    description: '콤마 구분 태그 목록 — 하나라도 일치하면 매칭(OR)',
    example: 'vision,mnist',
  })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : (value as unknown),
  )
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ enum: ['pytorch', 'tensorflow', 'huggingface'] })
  @IsIn(['pytorch', 'tensorflow', 'huggingface'])
  @IsOptional()
  framework?: ToolFramework;
}
