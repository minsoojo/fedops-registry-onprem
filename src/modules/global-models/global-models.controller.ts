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
import { GlobalModelsService } from './global-models.service';

/**
 * 배치 업로드 1회당 파일 개수·크기 상한.
 *
 * 단건 PUT(`ObjectStorageService.putStream`)은 메모리에 파일 전체를 안 올리지만,
 * 이 배치 라우트는 multer로 각 파일을 **메모리에 버퍼링**한다(멀티파트 스트리밍 파서는
 * 훨씬 복잡해 배치 업로드에서는 절충했다). 체크포인트는 클 수 있으므로 개수를
 * task-assets보다 줄이고(10개) 파일당 상한을 넉넉히 잡되(50MB) 최악 총량(500MB)이
 * 무한정 커지지 않게 막는다 — 그보다 큰 파일은 단건 `PUT`(스트리밍)을 쓸 것.
 */
const MAX_FILES_PER_BATCH = 10;
const MAX_BATCH_FILE_BYTES = 50 * 1024 * 1024;

/** `task-assets.controller.ts`와 동일한 이유의 가드 — 전역 body parser가 삼키는 타입. */
const PARSER_CLAIMED_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
];

/**
 * Global 모델(`fedops-models/{taskId}/`) 관리 API — FedOps1 전용
 * (FedOps2-Registry에는 없다).
 */
@ApiTags('Global Models')
@Controller({ path: 'registry/global-models', version: '1' })
export class GlobalModelsController {
  private readonly logger = new Logger(GlobalModelsController.name);

  constructor(private readonly globalModels: GlobalModelsService) {}

  @Get(':taskId/files')
  @ApiOperation({ summary: 'global 모델 파일 목록' })
  @ApiParam({ name: 'taskId' })
  @ApiResponse({ status: 200, description: '파일 목록 반환' })
  list(@Param('taskId') taskId: string) {
    return this.globalModels.list(taskId);
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
      'global 모델 파일 여러 개를 한 요청으로 업로드 — multipart/form-data, 필드명 "files" 반복',
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
      `Global model batch upload started — taskId=${taskId} count=${files.length}`,
    );
    return this.globalModels.uploadMany(
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
    const object = await this.globalModels.download(taskId, filename);
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
      'global 모델 업로드 — 파일 바이너리를 요청 본문으로 그대로 보낸다(스트리밍)',
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
      `Global model upload started — taskId=${taskId} file=${filename}`,
    );

    return this.globalModels.upload(taskId, filename, req, contentType);
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
      `Global model delete requested — taskId=${taskId} file=${filename}`,
    );
    return this.globalModels.remove(taskId, filename);
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'global 모델 전체 삭제 — task 삭제 시 호출자(FedOps1-Console-Adapter 등)가 정리 용도로 쓴다',
  })
  @ApiParam({ name: 'taskId' })
  @ApiResponse({
    status: 204,
    description: '삭제됨(파일이 하나도 없었어도 204)',
  })
  removeAll(@Param('taskId') taskId: string) {
    this.logger.log(`Global model cleanup requested — taskId=${taskId}`);
    return this.globalModels.removeAll(taskId);
  }

  private assertStreamableContentType(contentType?: string): void {
    if (!contentType) return;

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
