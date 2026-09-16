import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

export class PublishLlmDto {
  @ApiProperty({
    description: 'LLM 식별자 (소문자 영숫자-하이픈)',
    example: 'llama-3-8b-instruct',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'llm_id must be lowercase alphanumeric with hyphens only',
  })
  llm_id: string;

  @ApiProperty({ description: 'LLM version (llm_id별 단조증가)', example: 1 })
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({ description: '표시 이름' })
  @IsString()
  @IsNotEmpty()
  display_name: string;

  @ApiProperty({ enum: ['registry', 'huggingface'] })
  @IsIn(['registry', 'huggingface'])
  source: 'registry' | 'huggingface';

  // source === 'huggingface'일 때만 필요
  @ApiPropertyOptional()
  @ValidateIf((dto: PublishLlmDto) => dto.source === 'huggingface')
  @IsString()
  @IsNotEmpty()
  repo_id?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: PublishLlmDto) => dto.source === 'huggingface')
  @IsString()
  @IsNotEmpty()
  filename?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: PublishLlmDto) => dto.source === 'huggingface')
  @IsString()
  @IsNotEmpty()
  revision?: string;

  @ApiPropertyOptional({ description: 'LLM 설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      '표시용 버전 라벨(예: "q4-k-m" 양자화 표기) — version(정수)과 별개로 조회 필터에 쓰인다',
  })
  @IsString()
  @IsOptional()
  version_label?: string;

  @ApiProperty({ description: 'Registry에 공개 여부' })
  @IsBoolean()
  is_public: boolean;
}
