import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ToolsService } from './tools.service';
import { PublishToolDto } from './dto/publish-tool.dto';
import { UpdateToolVisibilityDto } from './dto/update-tool-visibility.dto';
import { UpdateToolEnabledDto } from './dto/update-tool-enabled.dto';
import { ListToolsQueryDto } from './dto/list-tools-query.dto';

@ApiTags('Registry - Tools')
@Controller({ path: 'registry/tools', version: '1' })
export class ToolsController {
  private readonly logger = new Logger(ToolsController.name);

  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Tool 목록 조회 (search/page/limit/publicOnly + tags/framework, 페이지네이션 봉투 반환)',
  })
  @ApiResponse({
    status: 200,
    description: '{ items, total, page, limit } 형태로 반환',
  })
  findAll(@Query() query: ListToolsQueryDto) {
    return this.toolsService.findAll(query);
  }

  @Get(':toolId/revisions')
  @ApiOperation({
    summary: 'Tool의 전체 revision 이력 조회 (revision 내림차순)',
  })
  @ApiParam({ name: 'toolId' })
  @ApiResponse({ status: 200, description: 'revision 목록 반환' })
  @ApiResponse({ status: 404, description: 'Tool 없음' })
  findRevisions(@Param('toolId') toolId: string) {
    return this.toolsService.findRevisions(toolId);
  }

  @Get(':toolId')
  @ApiOperation({
    summary:
      'Tool 단건 조회 (manifest/model_py_source 포함 — 별도 download-url 불필요)',
  })
  @ApiParam({ name: 'toolId' })
  @ApiResponse({ status: 200, description: 'Tool 반환' })
  @ApiResponse({ status: 404, description: 'Tool 없음' })
  findOne(
    @Param('toolId') toolId: string,
    @Query('revision', new ParseIntPipe({ optional: true })) revision?: number,
  ) {
    return this.toolsService.findOne(toolId, revision);
  }

  @Post()
  @ApiOperation({
    summary:
      'Tool 발행 (JSON body로 manifest/model_py_source 제출, revision은 서버가 계산)',
  })
  @ApiResponse({ status: 201, description: 'Tool 등록됨' })
  @ApiResponse({
    status: 400,
    description: 'manifest가 객체가 아니거나 model_py_source가 비어 있음',
  })
  publish(@Body() dto: PublishToolDto) {
    // architecture-v0.4.md §7.2 — 멀티파트 업로드는 없다. auto/manual 조립은 호출자
    // (Server-Manager)의 책임이고, Registry는 완성된 콘텐츠만 받는다.
    return this.toolsService.publish(dto);
  }

  @Patch(':toolId/visibility')
  @ApiOperation({ summary: 'Tool 공개 여부 변경' })
  @ApiParam({ name: 'toolId' })
  @ApiResponse({ status: 404, description: 'Tool 없음' })
  updateVisibility(
    @Param('toolId') toolId: string,
    @Body() dto: UpdateToolVisibilityDto,
  ) {
    return this.toolsService.updateVisibility(toolId, dto);
  }

  @Patch(':toolId/enabled')
  @ApiOperation({ summary: 'Tool 활성화 여부 변경' })
  @ApiParam({ name: 'toolId' })
  @ApiResponse({ status: 404, description: 'Tool 없음' })
  updateEnabled(
    @Param('toolId') toolId: string,
    @Body() dto: UpdateToolEnabledDto,
  ) {
    return this.toolsService.updateEnabled(toolId, dto);
  }
}
