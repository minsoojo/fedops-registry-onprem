import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LlmsService } from './llms.service';
import { PublishLlmDto } from './dto/publish-llm.dto';
import { ListLlmsQueryDto } from './dto/list-llms-query.dto';
import { UpdateLlmVisibilityDto } from './dto/update-llm-visibility.dto';
import { UpdateLlmEnabledDto } from './dto/update-llm-enabled.dto';

@ApiTags('Registry - LLMs')
@Controller({ path: 'registry/llms', version: '1' })
export class LlmsController {
  constructor(private readonly llmsService: LlmsService) {}

  @Get()
  @ApiOperation({
    summary:
      'LLM 목록 조회 (search/page/limit/publicOnly + source, 페이지네이션 봉투 반환)',
  })
  @ApiResponse({
    status: 200,
    description: '{ items, total, page, limit } 형태로 반환',
  })
  findAll(@Query() query: ListLlmsQueryDto) {
    return this.llmsService.findAll(query);
  }

  @Get(':llmId/download')
  @ApiOperation({
    summary:
      'registry-hosted LLM 바이너리 presigned 다운로드 URL 발급 (source=registry 전용)',
  })
  @ApiParam({ name: 'llmId' })
  @ApiResponse({ status: 200, description: 'presigned URL 반환' })
  @ApiResponse({
    status: 400,
    description: 'huggingface 소스 — 이 라우트는 registry 소스 전용',
  })
  @ApiResponse({ status: 404, description: 'LLM 없음' })
  getDownloadUrl(@Param('llmId') llmId: string) {
    return this.llmsService.getDownloadUrl(llmId);
  }

  @Get(':llmId')
  @ApiOperation({ summary: 'LLM 단건 조회' })
  @ApiParam({ name: 'llmId' })
  @ApiResponse({ status: 200, description: 'LLM 반환' })
  @ApiResponse({ status: 404, description: 'LLM 없음' })
  findOne(@Param('llmId') llmId: string) {
    return this.llmsService.findOne(llmId);
  }

  @Post()
  @ApiOperation({
    summary:
      'LLM 등록 (source=registry: 바이너리 업로드 필요, source=huggingface: 참조만 저장)',
  })
  @ApiResponse({ status: 201, description: 'LLM 등록됨' })
  @ApiResponse({
    status: 400,
    description:
      "source='registry' — 이 라우트는 아직 바이너리를 받지 못한다(멀티파트 미배선)",
  })
  publish(@Body() dto: PublishLlmDto) {
    // NOTE: source==='registry'의 바이너리 전송 방식(멀티파트 vs presigned PUT)은 아직
    // 미결이라 이 라우트는 JSON body만 받는다 — 서비스가 400으로 거부한다.
    // source==='huggingface'는 참조만 저장하므로 이 라우트로 완전히 동작한다.
    return this.llmsService.publish(dto);
  }

  @Patch(':llmId/visibility')
  @ApiOperation({ summary: 'LLM 공개 여부 변경' })
  @ApiParam({ name: 'llmId' })
  @ApiResponse({ status: 404, description: 'LLM 없음' })
  updateVisibility(
    @Param('llmId') llmId: string,
    @Body() dto: UpdateLlmVisibilityDto,
  ) {
    return this.llmsService.updateVisibility(llmId, dto);
  }

  @Patch(':llmId/enabled')
  @ApiOperation({ summary: 'LLM 활성화 여부 변경' })
  @ApiParam({ name: 'llmId' })
  @ApiResponse({ status: 404, description: 'LLM 없음' })
  updateEnabled(
    @Param('llmId') llmId: string,
    @Body() dto: UpdateLlmEnabledDto,
  ) {
    return this.llmsService.updateEnabled(llmId, dto);
  }
}
