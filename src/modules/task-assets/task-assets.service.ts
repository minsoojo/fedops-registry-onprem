import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import {
  ObjectStorageService,
  ObjectStream,
} from '../storage/object-storage.service';

/** 멀티파일 업로드 한 건의 입력 — multer가 메모리에 올려준 buffer 그대로 받는다. */
export interface TaskAssetUploadInput {
  filename: string;
  buffer: Buffer;
  contentType?: string;
}

/** task 폴더 안의 파일 하나. */
export interface TaskAssetInfo {
  name: string;
  size: number;
  updatedAt?: string;
}

/** 업로드 완료 응답 — 어디에 저장됐는지 확인할 수 있게 키를 돌려준다. */
export interface TaskAssetUploadResult {
  key: string;
  filename: string;
}

/**
 * 파일명 허용 규칙 — FedOps2-Server-Manager `task-assets.service.ts`는 `.py`/`.yaml`만
 * 허용했지만(태스크 코드 전용), FedOps1은 task 종속파일이 정형화돼 있지 않다는 전제이므로
 * **확장자를 제한하지 않는다.** 대신 경로 조립에 쓰일 수 있는 문자를 전부 막아 traversal을
 * 구조적으로 불가능하게 한다(Server-Manager `eval-assets.service.ts`와 동일한 패턴):
 * - 슬래시(`/`)·역슬래시(`\`)가 문자 클래스에 없다 → 중첩 경로·절대경로 불가
 * - 첫 글자를 영숫자로 고정 → `..`, `../x`, `.hidden`이 전부 걸린다
 */
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 파일명 길이 상한 — S3 키 길이(1024B) 안에서 여유 있게 잡는다. */
export const MAX_FILENAME_LENGTH = 128;

/** task 폴더당 최대 파일 수. */
export const MAX_FILE_COUNT = 100;

/**
 * Task 종속파일(`fedops-tasks/{taskId}/task/`)의 저장 위치를 아는 유일한 지점.
 *
 * FedOps2에서는 이 자산을 Server-Manager 전용 MinIO가 소유했지만, FedOps1은 이 Registry로
 * 병합했다 — FedOps2-Registry에는 없는 FedOps1 전용 모듈이다.
 *
 * Registry는 "Task를 모른다"는 기존 원칙(architecture-v0.4.md §4)을 그대로 따른다 —
 * `taskId`는 호출자가 이미 검증한 불투명 참조로 취급하고, 이 서비스는 존재 확인을 하지
 * 않는다(Server-Manager의 `TaskAssetsService`와 달리 `TasksService` 의존이 아예 없다 —
 * Registry에는 Task 도메인 자체가 없기 때문이다).
 *
 * 바이트는 여기를 스트림으로 통과한다 — 임의 파일(바이너리 포함)을 이 프로세스
 * 메모리에 전부 올리지 않기 위함이다(`ObjectStorageService.putStream`/`getObjectStream`).
 */
@Injectable()
export class TaskAssetsService {
  private readonly logger = new Logger(TaskAssetsService.name);
  private readonly bucket: string;

  constructor(
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>('AWS_S3_TASKS_BUCKET') ?? 'fedops-tasks';
  }

  /** 워크플로 init container가 받아가는 프리픽스와 동일하게 조립한다. */
  private prefixFor(taskId: string): string {
    return `${taskId}/task/`;
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

  async list(taskId: string): Promise<TaskAssetInfo[]> {
    const prefix = this.prefixFor(taskId);
    const objects = await this.storage.list(this.bucket, prefix);

    return (
      objects
        .map((o) => ({
          name: o.key.slice(prefix.length),
          size: o.size,
          updatedAt: o.updatedAt,
        }))
        // 프리픽스 자체(디렉토리 플레이스홀더)와 중첩 경로는 제외한다 —
        // 이 API가 만들 수 있는 것만 보여주기 위함이다.
        .filter((f) => f.name.length > 0 && f.name.indexOf('/') === -1)
    );
  }

  /** 파일을 스트림으로 돌려준다. 없으면 null (호출자가 404 여부를 정한다). */
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

  /**
   * 업로드 스트림을 task 폴더에 저장한다. 가드를 전부 통과한 뒤에야 스트림을
   * 소비한다 — 거절할 요청의 바이트를 굳이 스토리지까지 흘려보내지 않기 위함이다.
   */
  async upload(
    taskId: string,
    filename: string,
    body: Readable,
    contentType?: string,
  ): Promise<TaskAssetUploadResult> {
    this.assertValidFilename(filename);

    const existing = await this.list(taskId);
    const isNew = !existing.some((f) => f.name === filename);
    if (isNew && existing.length >= MAX_FILE_COUNT) {
      throw new BadRequestException(
        `Task '${taskId}' already has ${existing.length} files — the limit is ${MAX_FILE_COUNT}.`,
      );
    }

    const key = this.keyFor(taskId, filename);
    await this.storage.putStream(this.bucket, key, body, contentType);
    this.logger.log(`Task asset uploaded — task_id=${taskId} file=${filename}`);

    return { key, filename };
  }

  /**
   * 여러 파일을 한 요청으로 저장한다(멀티파트 배치 업로드).
   *
   * **전부 검증한 뒤에야 하나라도 쓴다** — 파일 5개 중 4번째가 잘못된 이름이라고
   * 앞의 3개는 이미 저장된 채로 400을 돌려주면 호출자가 절반만 성공한 상태를
   * 스스로 추적해야 한다. 그런 부분성공을 피하려고 all-or-nothing으로 간다
   * (개별 파일 API의 "가드 통과 후에만 스트림 소비"와 같은 이유).
   */
  async uploadMany(
    taskId: string,
    files: TaskAssetUploadInput[],
  ): Promise<TaskAssetUploadResult[]> {
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
        `Task '${taskId}' would have ${existing.length + newCount} files — the limit is ${MAX_FILE_COUNT}.`,
      );
    }

    const results: TaskAssetUploadResult[] = [];
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
      `Task assets batch uploaded — task_id=${taskId} count=${files.length}`,
    );
    return results;
  }

  async remove(taskId: string, filename: string): Promise<void> {
    this.assertValidFilename(filename);
    await this.storage.delete(this.bucket, this.keyFor(taskId, filename));
    this.logger.log(`Task asset deleted — task_id=${taskId} file=${filename}`);
  }

  /** task 삭제 시 자산 전체 정리. */
  async removeAll(taskId: string): Promise<void> {
    await this.storage.deletePrefix(this.bucket, `${taskId}/`);
    this.logger.log(`Task assets cleared — task_id=${taskId}`);
  }
}
