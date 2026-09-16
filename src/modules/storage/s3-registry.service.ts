import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from './object-storage.service';

/** presigned 다운로드 URL 기본 유효기간 — 호출자가 명시하면 그 값이 우선한다. */
export const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 3600;

/**
 * Registry용 오브젝트 스토리지 레이어 — LLM 바이너리 전용
 * (architecture-v0.3.md §13.2, §5d / architecture-v0.4.md §2).
 *
 * Tool 번들(manifest+model.py)은 §14 결정에 따라 오브젝트 스토리지를 쓰지 않고
 * tool-registry Mongo 문서에 직접 embed하므로, 이 서비스는 llm-registry의
 * registry-hosted LLM 바이너리 업로드/다운로드 용도로만 존재한다.
 *
 * v0.4에서 Registry가 독립 서비스가 되면서, 이 서비스는 이 프로세스 자체의
 * `ObjectStorageService`(Server-Manager에서 복제한 범용 MinIO 클라이언트)를 주입받아
 * 그 위에 LLM 키 규칙(`{llmId}/{version}/{filename}`)만 얹는 얇은 레이어다.
 */
@Injectable()
export class S3RegistryService {
  private readonly logger = new Logger(S3RegistryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /** LLM 바이너리가 저장되는 버킷 (기본값 fedops-llms). */
  private get bucket(): string {
    return this.config.get<string>('AWS_S3_LLMS_BUCKET') ?? 'fedops-llms';
  }

  /**
   * LLM 바이너리를 업로드하고 저장된 오브젝트 키를 반환한다.
   * 이 키가 `llm-registry` 문서의 `ref.s3_key`가 된다.
   */
  async uploadLlmBinary(
    llmId: string,
    version: number,
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const key = `${llmId}/${version}/${filename}`;
    await this.objectStorage.putObject(
      this.bucket,
      key,
      buffer,
      'application/octet-stream',
    );
    this.logger.log(
      `uploadLlmBinary() llm_id=${llmId} version=${version} key=${this.bucket}/${key} bytes=${buffer.length}`,
    );
    return key;
  }

  /** `ref.s3_key`에 대한 시간제한 다운로드 URL을 발급한다. */
  async getPresignedDownloadUrl(
    key: string,
    expiresSeconds: number = DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    const url = await this.objectStorage.getPresignedUrl(
      this.bucket,
      key,
      expiresSeconds,
    );
    this.logger.log(
      `getPresignedDownloadUrl() key=${this.bucket}/${key} expires_in=${expiresSeconds}`,
    );
    return url;
  }
}
