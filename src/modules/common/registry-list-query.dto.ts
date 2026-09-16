import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from './registry-list.util';

/**
 * Registry 목록 조회 공통 쿼리 파라미터 (architecture-v0.4.md §7.1).
 * 리소스별 추가 필터는 이 클래스를 상속해 얹는다.
 */
export class RegistryListQueryDto {
  @ApiPropertyOptional({
    description: '이름/설명/태그 대상 대소문자 무시 부분일치 검색어',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: '페이지 번호 (1-base)',
    default: DEFAULT_PAGE,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: '페이지 크기', default: DEFAULT_LIMIT })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    description: '공개(is_public)+활성(enabled) 엔트리만 반환',
    enum: ['true', 'false'],
  })
  // boolean으로 선언하면 안 된다 (docs/issues/0008). 전역 ValidationPipe의 implicit
  // conversion이 Boolean 대상에 !!value를 쓰는데, 이 변환이 커스텀 @Transform보다 먼저
  // 실행돼서 'false'가 이미 true로 뒤집힌 뒤에야 @Transform이 값을 받는다 — @Transform으로는
  // 되돌릴 수 없다. 그래서 문자열 그대로 받고, 서비스가 `=== 'true'`로 직접 판정한다.
  @IsIn(['true', 'false'])
  @IsOptional()
  publicOnly?: 'true' | 'false';
}
