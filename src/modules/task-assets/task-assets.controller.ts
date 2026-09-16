import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { TaskAssetsService } from './task-assets.service';

/**
 * 배치 업로드 1회당 파일 개수·크기 상한.
 *
 * 단건 PUT과 달리 이 라우트는 multer로 각 파일을 **메모리에 버퍼링**한다(멀티파트를
 * 파싱하면서 동시에 스트리밍하는 건 훨씬 복잡해 배치 업로드에서는 절충했다) — 그래서
 * 무제한으로 둘 수 없다. task 종속파일은 보통 코드 몇 KB라 20개 × 10MB(최악 200MB)면
 * 넉넉하다.
 */
const MAX_FILES_PER_BATCH = 20;
const MAX_BATCH_FILE_BYTES = 10 * 1024 * 1024;

/**
 * 전역 body parser가 삼켜버리는 Content-Type 목록.
 *
 * `main.ts`가 기본 활성화하는 JSON/urlencoded 파서는 **Content-Type으로 대상을
 * 고른다.** 아래 타입으로 오면 파서가 본문을 먼저 다 읽어버려 스트림이 비어버린다.
 * 조용히 빈 파일을 저장하는 대신 415로 분명하게 거절한다 — 업로더는
 * `application/octet-stream` 같은 걸 써야 한다(Server-Manager `eval-files.controller.ts`와
 * 동일한 가드).
 */
const PARSER_CLAIMED_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
];

/**
 * Task 종속파일(`fedops-tasks/{taskId}/task/`) 관리 API — FedOps1 전용
 * (FedOps2-Registry에는 없다. Task 코드는 FedOps2에서 Server-Manager가 소유한다).
 *
 * `.py`/`.yaml`로 제한하던 FedOps2 쪽과 달리 확장자를 제한하지 않는다 — task 종속파일이
 * 정형화돼 있지 않다는 FedOps1의 전제 때문이다. 업로드·다운로드 모두 요청 본문을
 * 스트림 그대로 주고받는다(파일 전체를 메모리에 올리지 않는다).
 */
@ApiTags('Task Assets')
@Controller({ path: 'registry/task-assets', version: '1' })
export class TaskAssetsController {
  private readonly logger = new Logger(TaskAssetsController.name);

  constructor(private readonly taskAssets: TaskAssetsService) {}

  @Get(':taskId/files')
  @ApiOperation({ summary: 'task 종속파일 목록' })
  @ApiParam({ name: 'taskId' })
  @ApiResponse({ status: 200, description: '파일 목록 반환' })
  list(@Param('taskId') taskId: string) {
    return this.taskAssets.list(taskId);
  }

  @Post(':taskId/files')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_BATCH, {
      limits: { fileSize: MAX_BATCH_FILE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'task 종속파일 여러 개를 한 요청으로 업로드 — multipart/form-data, 필드명 "files" 반복',
  })
  @ApiParam({ name: 'taskId' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '업로드됨 — 파일별 { key, filename } 배열 반환',
  })
  @ApiResponse({
    status: 400,
    description:
      '파일 없음 / 허용되지 않는 파일명 / 배치 내 파일명 중복 / 개수 상한 초과 — 하나라도 걸리면 전부 저장 안 함',
  })
  uploadMany(
    @Param('taskId') taskId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required.');
    }
    this.logger.log(
      `Task assets batch upload started — taskId=${taskId} count=${files.length}`,
    );
    return this.taskAssets.uploadMany(
      taskId,
      files.map((f) => ({
        filename: f.originalname,
        buffer: f.buffer,
        contentType: f.mimetype,
      })),
    );
  }

  @Get(':taskId/files/:filename')
  @ApiOperation({ summary: '파일 다운로드 — 바이너리 그대로 스트리밍' })
  @ApiParam({ name: 'taskId' })
  @ApiParam({ name: 'filename', description: '디렉토리 불가' })
  @ApiResponse({ status: 200, description: '파일 바이너리 스트림' })
  @ApiResponse({ status: 400, description: '허용되지 않는 파일명' })
  @ApiResponse({ status: 404, description: '파일 없음' })
  async download(
    @Param('taskId') taskId: string,
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const object = await this.taskAssets.download(taskId, filename);
    if (!object) {
      throw new NotFoundException(
        `File '${filename}' not found for task '${taskId}'`,
      );
    }
    res.set({
      'Content-Type': object.contentType ?? 'application/octet-stream',
      ...(object.contentLength !== undefined
        ? { 'Content-Length': String(object.contentLength) }
        : {}),
    });
    return new StreamableFile(object.stream);
  }

  @Put(':taskId/files/:filename')
  @ApiOperation({
    summary:
      'task 종속파일 업로드 — 파일 바이너리를 요청 본문으로 그대로 보낸다(스트리밍)',
  })
  @ApiParam({ name: 'taskId' })
  @ApiParam({
    name: 'filename',
    description: '디렉토리 불가, 확장자 제한 없음',
  })
  @ApiBody({
    description:
      '파일 바이너리 그 자체. JSON으로 감싸지 않는다. Content-Type은 application/octet-stream 권장.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 200, description: '업로드됨 — 저장된 키 반환' })
  @ApiResponse({
    status: 400,
    description: '허용되지 않는 파일명 / 개수 상한 초과',
  })
  @ApiResponse({
    status: 415,
    description: '전역 body parser가 삼키는 Content-Type (JSON 등)',
  })
  async upload(
    @Param('taskId') taskId: string,
    @Param('filename') filename: string,
    @Req() req: Request,
    @Headers('content-type') contentType?: string,
  ) {
    this.assertStreamableContentType(contentType);

    this.logger.log(
      `Task asset upload started — taskId=${taskId} file=${filename}`,
    );

    // `req`는 아직 아무도 읽지 않은 IncomingMessage(Readable)다 — 위 Content-Type
    // 가드 덕분에 body parser가 건드리지 않았음이 보장된다.
    return this.taskAssets.upload(taskId, filename, req, contentType);
  }

  @Delete(':taskId/files/:filename')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '파일 삭제' })
  @ApiParam({ name: 'taskId' })
  @ApiParam({ name: 'filename' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  @ApiResponse({ status: 400, description: '허용되지 않는 파일명' })
  remove(@Param('taskId') taskId: string, @Param('filename') filename: string) {
    this.logger.log(
      `Task asset delete requested — taskId=${taskId} file=${filename}`,
    );
    return this.taskAssets.remove(taskId, filename);
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'task 종속파일 전체 삭제 — task 삭제 시 호출자(FedOps1-Console-Adapter 등)가 정리 용도로 쓴다',
  })
  @ApiParam({ name: 'taskId' })
  @ApiResponse({
    status: 204,
    description: '삭제됨(파일이 하나도 없었어도 204)',
  })
  removeAll(@Param('taskId') taskId: string) {
    this.logger.log(`Task assets cleanup requested — taskId=${taskId}`);
    return this.taskAssets.removeAll(taskId);
  }

  private assertStreamableContentType(contentType?: string): void {
    if (!contentType) return; // 타입 없음 = 어떤 파서도 집어가지 않음 → 그대로 스트림

    const mediaType = contentType.split(';')[0].trim().toLowerCase();
    if (PARSER_CLAIMED_TYPES.includes(mediaType)) {
      throw new UnsupportedMediaTypeException(
        `Content-Type '${mediaType}' is consumed by the request body parser and cannot be ` +
          `streamed. Send the raw file bytes with a binary Content-Type such as ` +
          `'application/octet-stream'.`,
      );
    }
  }
}
