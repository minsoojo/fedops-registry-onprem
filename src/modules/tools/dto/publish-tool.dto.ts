import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/**
 * Tool 발행 요청 (architecture-v0.4.md §7.2).
 *
 * 멀티파트 파일 업로드는 없다 — manifest/model.py는 항상 JSON body로 온다.
 * Registry에 도착하는 시점엔 이미 완성된 콘텐츠이고(auto/manual 조립은 호출자인
 * Server-Manager의 책임), Registry는 그걸 어떻게 만들었는지 몰라야 한다.
 *
 * `revision`은 클라이언트가 지정하지 않는다 — ToolsService.publish()가 tool_id별
 * 최신값 +1로 계산한다 (docs/issues/0007).
 */
export class PublishToolDto {
  @ApiProperty({
    description: 'Tool 식별자 (소문자 영숫자-하이픈)',
    example: 'mnist-classifier',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'tool_id must be lowercase alphanumeric with hyphens only',
  })
  tool_id: string;

  @ApiProperty({ description: '이 Tool이 감싸는 원본 Task ID' })
  @IsString()
  @IsNotEmpty()
  source_task_id: string;

  @ApiProperty({
    description: '이 Tool이 감싸는 원본 글로벌 모델 버전 (gl_model_v)',
  })
  @IsInt()
  @Min(1)
  source_model_version: number;

  @ApiProperty({
    description:
      'tool-manifest.json 전체 내용 (Registry는 내용을 해석하지 않고 그대로 embed한다)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  manifest: Record<string, unknown>;

  @ApiProperty({
    description:
      'model.py 소스 코드 텍스트 (auto 경로면 호출자가 제네릭 래퍼로 채워 보낸다)',
  })
  @IsString()
  @IsNotEmpty()
  model_py_source: string;

  @ApiPropertyOptional({
    description:
      'auto 경로 전용 — 원본 task/model.py 소스(get_model() 포함). manual 경로면 생략',
    default: '',
  })
  @IsString()
  @IsOptional()
  source_model_py_source?: string;

  @ApiProperty({
    description:
      '표시용 메타데이터 — 호출자가 manifest/model.py를 자동 생성했는지(auto) Task owner가 직접 작성했는지(manual). Registry의 저장 로직은 이 값으로 분기하지 않는다',
    enum: ['auto', 'manual'],
  })
  @IsIn(['auto', 'manual'])
  wrapper_mode: 'auto' | 'manual';

  @ApiProperty({ enum: ['pytorch', 'tensorflow', 'huggingface'] })
  @IsIn(['pytorch', 'tensorflow', 'huggingface'])
  framework: 'pytorch' | 'tensorflow' | 'huggingface';

  @ApiPropertyOptional({ description: 'Tool 설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: '검색용 태그', type: [String] })
  @IsArray()
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    description:
      '표시용 버전 라벨(예: "federated-v1") — revision(정수)과 별개로 조회 필터에 쓰인다',
  })
  @IsString()
  @IsOptional()
  version_label?: string;

  @ApiProperty({ description: 'Registry에 공개 여부' })
  @IsBoolean()
  is_public: boolean;
}
