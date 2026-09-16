import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import {
  ObjectStorageService,
  ObjectStream,
} from '../storage/object-storage.service';

/** 멀티파일 업로드 한 건의 입력 — multer가 메모리에 올려준 buffer 그대로 받는다. */
export interface GlobalModelUploadInput {
  filename: string;
  buffer: Buffer;
  contentType?: string;
}

/** global model 폴더 안의 파일 하나(체크포인트 등). */
export interface GlobalModelFileInfo {
  name: string;
  size: number;
  updatedAt?: string;
}

export interface GlobalModelUploadResult {
  key: string;
  filename: string;
}

/**
 * 파일명 허용 규칙 — 프레임워크마다 확장자가 다르므로(`.pt`/`.h5`/`.onnx`/`.bin` 등)
 * 제한하지 않는다. `task-assets.service.ts`와 동일한 문자 제약으로 경로 traversal만 막는다.
 */
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MAX_FILENAME_LENGTH = 128;

/** task당 최대 파일 수 — 체크포인트를 여러 round 보관해도 넉넉하도록 여유 있게 잡는다. */
export const MAX_FILE_COUNT = 50;

/**
 * Global 모델(`fedops-models/{taskId}/`)의 저장 위치를 아는 유일한 지점 — FedOps1 전용
 * (FedOps2-Registry에는 없다).
 *
 * FedOps2에서는 Server-Manager `GlobalModelAssetsService`가 이 프리픽스를 소유했지만
 * 읽기/쓰기는 Task-FL-Server(Python)가 `S3ModelStore`로 직접 수행했다(Server-Manager는
 * task 삭제 시 정리만 담당). FedOps1은 이 저장소를 Registry로 병합하면서 list/upload/
 * download/delete를 전부 이 API로 노출한다 — Python 쪽 직접 접근 경로를 대체하는지,
 * 병행하는지는 FedOps1 트랙의 클라이언트 작업에서 결정할 별건이다(이 서비스는 저장소
 * 계층만 제공한다).
 *
 * Registry는 "Task를 모른다"는 기존 원칙을 그대로 따른다 — `taskId`는 불투명 참조로
 * 취급하고 존재 확인을 하지 않는다.
 */
@Injectable()
export class GlobalModelsService {
  private readonly logger = new Logger(GlobalModelsService.name);
  private readonly bucket: string;

  constructor(
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.bucket =
      config.get<string>('AWS_S3_GLOBAL_MODEL_BUCKET') ?? 'fedops-models';
  }

  private prefixFor(taskId: string): string {
    return `${taskId}/`;
  }

  private keyFor(taskId: string, filename: string): string {
    return `${this.prefixFor(taskId)}${filename}`;
  }

  assertValidFilename(filename: string): void {
    if (!FILENAME_PATTERN.test(filename)) {
      throw new BadRequestException(
        `Invalid filename '${filename}' — must start with a letter or digit and ` +
          `contain only letters, digits, '.', '_' and '-' (no directories).`,
      );
    }
    if (filename.length > MAX_FILENAME_LENGTH) {
      throw new BadRequestException(
        `Filename is ${filename.length} characters — the limit is ${MAX_FILENAME_LENGTH}.`,
      );
    }
  }

  async list(taskId: string): Promise<GlobalModelFileInfo[]> {
    const prefix = this.prefixFor(taskId);
    const objects = await this.storage.list(this.bucket, prefix);

    return objects
      .map((o) => ({
        name: o.key.slice(prefix.length),
        size: o.size,
        updatedAt: o.updatedAt,
      }))
      .filter((f) => f.name.length > 0 && f.name.indexOf('/') === -1);
  }

  async download(
    taskId: string,
    filename: string,
  ): Promise<ObjectStream | null> {
    this.assertValidFilename(filename);
    return this.storage.getObjectStream(
      this.bucket,
      this.keyFor(taskId, filename),
    );
  }

  async upload(
    taskId: string,
    filename: string,
    body: Readable,
    contentType?: string,
  ): Promise<GlobalModelUploadResult> {
    this.assertValidFilename(filename);

    const existing = await this.list(taskId);
    const isNew = !existing.some((f) => f.name === filename);
    if (isNew && existing.length >= MAX_FILE_COUNT) {
      throw new BadRequestException(
        `Task '${taskId}' already has ${existing.length} model files — the limit is ${MAX_FILE_COUNT}.`,
      );
    }

    const key = this.keyFor(taskId, filename);
    await this.storage.putStream(this.bucket, key, body, contentType);
    this.logger.log(
      `Global model uploaded — task_id=${taskId} file=${filename}`,
    );

    return { key, filename };
  }

  /**
   * 여러 파일을 한 요청으로 저장한다(멀티파트 배치 업로드) — `TaskAssetsService.uploadMany`와
   * 동일한 all-or-nothing 원칙(전부 검증한 뒤에야 하나라도 쓴다).
   */
  async uploadMany(
    taskId: string,
    files: GlobalModelUploadInput[],
  ): Promise<GlobalModelUploadResult[]> {
    if (files.length === 0) {
      throw new BadRequestException('At least one file is required.');
    }
    for (const file of files) {
      this.assertValidFilename(file.filename);
    }
    const uniqueNames = new Set(files.map((f) => f.filename));
    if (uniqueNames.size !== files.length) {
      throw new BadRequestException(
        'Duplicate filenames in the same batch are not allowed.',
      );
    }

    const existing = await this.list(taskId);
    const existingNames = new Set(existing.map((f) => f.name));
    const newCount = [...uniqueNames].filter(
      (n) => !existingNames.has(n),
    ).length;
    if (existing.length + newCount > MAX_FILE_COUNT) {
      throw new BadRequestException(
        `Task '${taskId}' would have ${existing.length + newCount} model files — the limit is ${MAX_FILE_COUNT}.`,
      );
    }

    const results: GlobalModelUploadResult[] = [];
    for (const file of files) {
      const key = this.keyFor(taskId, file.filename);
      await this.storage.putStream(
        this.bucket,
        key,
        Readable.from(file.buffer),
        file.contentType,
      );
      results.push({ key, filename: file.filename });
    }
    this.logger.log(
      `Global model batch uploaded — task_id=${taskId} count=${files.length}`,
    );
    return results;
  }

  async remove(taskId: string, filename: string): Promise<void> {
    this.assertValidFilename(filename);
    await this.storage.delete(this.bucket, this.keyFor(taskId, filename));
    this.logger.log(
      `Global model deleted — task_id=${taskId} file=${filename}`,
    );
  }

  /** task 삭제 시 글로벌 모델 전체 정리. */
  async removeAll(taskId: string): Promise<void> {
    await this.storage.deletePrefix(this.bucket, this.prefixFor(taskId));
    this.logger.log(`Global model assets cleared — task_id=${taskId}`);
  }
}
