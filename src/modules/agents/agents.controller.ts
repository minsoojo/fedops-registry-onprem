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
import { AgentsService } from './agents.service';
import { PublishAgentDto } from './dto/publish-agent.dto';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto';
import { UpdateAgentVisibilityDto } from './dto/update-agent-visibility.dto';
import { UpdateAgentEnabledDto } from './dto/update-agent-enabled.dto';
import { ResolveAgentConfigDto } from './dto/resolve-agent-config.dto';

@ApiTags('Registry - Agents')
@Controller({ path: 'registry/agents', version: '1' })
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Agent Config 목록 조회 (카탈로그 브라우징 — search/page/limit/publicOnly)',
  })
  @ApiResponse({
    status: 200,
    description: '{ items, total, page, limit } 형태로 반환',
  })
  findAll(@Query() query: ListAgentsQueryDto) {
    return this.agentsService.findAll(query);
  }

  @Get(':agentId')
  @ApiOperation({
    summary:
      'Agent Config 단건 조회 — 다른 Client가 재구성 시 이 응답을 그대로 사용',
  })
  @ApiParam({ name: 'agentId' })
  @ApiResponse({ status: 200, description: 'Agent Config 반환' })
  @ApiResponse({ status: 404, description: 'Agent 없음' })
  findOne(@Param('agentId') agentId: string) {
    return this.agentsService.findOne(agentId);
  }

  @Post('resolve')
  @ApiOperation({
    summary:
      'Agent Config의 llm/tools 참조(camelCase, 문자열 modelVersion 라벨)를 실제 Registry 엔트리로 조립. 일부 참조가 없거나 비활성화돼도 부분성공으로 응답',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ llm, tools, errors } — 못 찾았거나 비활성화된 항목은 null + errors[]에 사유(not_found|disabled)',
  })
  resolveConfig(@Body() dto: ResolveAgentConfigDto) {
    return this.agentsService.resolveConfig(dto);
  }

  @Post()
  @ApiOperation({ summary: 'Agent Config 발행 (upsert)' })
  @ApiResponse({ status: 201, description: 'Agent 등록됨' })
  publish(@Body() dto: PublishAgentDto) {
    return this.agentsService.publish(dto);
  }

  @Patch(':agentId/visibility')
  @ApiOperation({ summary: 'Agent 공개 여부 변경' })
  @ApiParam({ name: 'agentId' })
  @ApiResponse({ status: 404, description: 'Agent 없음' })
  updateVisibility(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentVisibilityDto,
  ) {
    return this.agentsService.updateVisibility(agentId, dto);
  }

  @Patch(':agentId/enabled')
  @ApiOperation({ summary: 'Agent 활성화 여부 변경' })
  @ApiParam({ name: 'agentId' })
  @ApiResponse({ status: 404, description: 'Agent 없음' })
  updateEnabled(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentEnabledDto,
  ) {
    return this.agentsService.updateEnabled(agentId, dto);
  }
}
