import {
  Controller,
  Get,
  Logger,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { TaskArchiveService } from './task-archive.service';

/**
 * taskId 하나의 Task 종속파일 + Global 모델을 ZIP 하나로 묶어 다운로드 — FedOps1 전용
 * (FedOps2-Registry에는 없다). `task-assets`/`global-models` 각각의 개별 파일 API로는
 * 여러 파일을 한 번에 받을 수 없어서 생긴 조합 엔드포인트다.
 */
@ApiTags('Task Archive')
@Controller({ path: 'registry/tasks', version: '1' })
export class TaskArchiveController {
  private readonly logger = new Logger(TaskArchiveController.name);

  constructor(private readonly taskArchive: TaskArchiveService) {}

  @Get(':taskId/archive')
  @ApiOperation({
    summary:
      'Task 종속파일 + Global 모델 전체를 ZIP으로 다운로드 (task/, models/ 폴더로 구분)',
  })
  @ApiParam({ name: 'taskId' })
  @ApiResponse({ status: 200, description: 'ZIP 바이너리 스트림' })
  @ApiResponse({
    status: 404,
    description: '두 도메인 다 파일이 하나도 없음',
  })
  async archive(
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.logger.log(`Archive requested — taskId=${taskId}`);
    const stream = await this.taskArchive.buildArchive(taskId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${taskId}.zip"`,
    });
    return new StreamableFile(stream);
  }
}
