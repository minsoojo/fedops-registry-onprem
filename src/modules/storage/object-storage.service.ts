import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'stream';

/**
 * 멀티파트 업로드 파트 크기 — S3 규격상 최소가 5MiB다.
 * 이 값이 곧 업로드 중 메모리에 올라오는 양의 상한이 된다(아래 `queueSize` 참고).
 * FedOps2-Server-Manager `object-storage.service.ts`의 동일 상수를 그대로 가져왔다.
 */
export const UPLOAD_PART_SIZE = 5 * 1024 * 1024;

/**
 * 동시에 전송할 파트 수. 1로 두면 어느 순간에도 파트 하나만 메모리에 있으므로
 * 파일이 아무리 커도 사용 메모리는 `UPLOAD_PART_SIZE`로 고정된다.
 */
export const UPLOAD_QUEUE_SIZE = 1;

/** `getObjectStream`의 반환값 — 스트림과 함께 원본 메타데이터를 실어 나른다. */
export interface ObjectStream {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}

/**
 * 범용 오브젝트 스토리지 클라이언트 — 실제 목적지는 클러스터 내 MinIO다.
 *
 * "S3"는 프로토콜/SDK 이름이며 AWS로 나가는 트래픽은 없다(docs/env-conventions.md
 * "AWS_ 접두사인데 AWS를 안 쓴다" 참고). 엔드포인트가 설정되지 않으면 SDK 기본값인
 * 실제 AWS S3로 향하므로, 클러스터에서는 반드시 주입돼야 한다.
 *
 * Server-Manager의 동명 서비스를 복제한 것이다 — 인스턴스를 공유하지 않고 코드 패턴만
 * 계승한다. FedOps1-Registry는 자기 전용 MinIO(별도 인스턴스·별도 자격증명)를 가리킨다
 * (docs/architecture/architecture-v0.4.md §2 — FedOps2 기준 문서이며 이 프로젝트는
 * 그 결정을 전제로 포크됐다. FedOps1 전용 차이점은 이 프로젝트의 README 참고).
 *
 * `putStream`/`getObjectStream`은 FedOps2-Registry에는 없던 메서드다 — Task 종속파일/
 * Global 모델처럼 텍스트가 아니고 크기도 가늠할 수 없는 자산을 이 프로세스 메모리에
 * 전부 올리지 않고 다루기 위해 Server-Manager `eval-assets` 경로의 스트리밍 패턴을
 * 그대로 이식했다.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  private readonly signingClient: S3Client;

  constructor(private readonly config: ConfigService) {
    // 정본은 AWS_S3_ENDPOINT_URL (docs/env-conventions.md §2).
    const endpoint = this.config.get<string>('AWS_S3_ENDPOINT_URL');

    if (!endpoint) {
      this.logger.warn(
        'No object storage endpoint configured — the SDK will target real AWS S3. ' +
          'Set AWS_S3_ENDPOINT_URL to the MinIO service address.',
      );
    }

    this.client = new S3Client({
      endpoint,
      region: this.config.get<string>('AWS_DEFAULT_REGION'),
      // MinIO는 virtual-host 스타일 주소를 쓰지 않는다.
      forcePathStyle: true,
    });
    const publicEndpoint = this.config.get<string>('AWS_S3_PUBLIC_ENDPOINT_URL');
    this.signingClient = publicEndpoint ? new S3Client({
      endpoint: publicEndpoint,
      region: this.config.get<string>('AWS_DEFAULT_REGION'),
      forcePathStyle: true,
    }) : this.client;
  }

  /** 프리픽스 바로 아래의 오브젝트를 나열한다(하위 디렉토리는 평면으로 포함). */
  async list(
    bucket: string,
    prefix: string,
  ): Promise<{ key: string; size: number; updatedAt?: string }[]> {
    try {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
      );
      return (res.Contents ?? []).map((o) => ({
        key: o.Key ?? '',
        size: o.Size ?? 0,
        updatedAt: o.LastModified?.toISOString(),
      }));
    } catch (e: unknown) {
      throw this.wrap('list', `${bucket}/${prefix}`, e);
    }
  }

  /** 텍스트 오브젝트를 읽는다. 없으면 null (호출자가 의미를 정한다). */
  async getText(bucket: string, key: string): Promise<string | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return (await res.Body?.transformToString()) ?? '';
    } catch (e: unknown) {
      if (this.isNotFound(e)) {
        this.logger.warn(`Object not found — ${bucket}/${key}`);
        return null;
      }
      throw this.wrap('read', `${bucket}/${key}`, e);
    }
  }

  async putText(bucket: string, key: string, body: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
      );
      this.logger.log(`Object written — ${bucket}/${key}`);
    } catch (e: unknown) {
      throw this.wrap('write', `${bucket}/${key}`, e);
    }
  }

  /**
   * 바이너리 오브젝트를 쓴다. `putText`와 달리 Buffer를 그대로 올리고 Content-Type을
   * 지정할 수 있다 — LLM 가중치처럼 텍스트가 아닌 자산용이다.
   */
  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType?: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      this.logger.log(
        `Binary object written — ${bucket}/${key} (${body.length} bytes)`,
      );
    } catch (e: unknown) {
      throw this.wrap('write', `${bucket}/${key}`, e);
    }
  }

  /**
   * 읽기 스트림을 그대로 오브젝트로 흘려보낸다 — 전체를 메모리에 담지 않는다.
   *
   * `PutObjectCommand`에 스트림을 그대로 넘기면 SDK가 `Content-Length`를 요구하므로
   * (길이를 미리 알 수 없는 업로드 스트림엔 없는 값) `lib-storage`의 `Upload`를 쓴다.
   * `queueSize`가 1이라 어느 순간에도 메모리에 있는 건 파트 하나(=`UPLOAD_PART_SIZE`)뿐
   * 이며, 이 상한은 파일 크기와 무관하다. `UPLOAD_PART_SIZE` 미만이면 `Upload`가 알아서
   * 단일 PUT으로 처리한다.
   */
  async putStream(
    bucket: string,
    key: string,
    body: Readable,
    contentType?: string,
  ): Promise<void> {
    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        },
        partSize: UPLOAD_PART_SIZE,
        queueSize: UPLOAD_QUEUE_SIZE,
        // 실패 시 중간에 올라간 파트를 남기지 않는다 — 안 그러면 버킷에
        // 아무도 모르는 미완성 멀티파트가 쌓여 스토리지를 먹는다.
        leavePartsOnError: false,
      });

      await upload.done();
      this.logger.log(`Object streamed — ${bucket}/${key}`);
    } catch (e: unknown) {
      throw this.wrap('stream', `${bucket}/${key}`, e);
    }
  }

  /**
   * 오브젝트를 읽기 스트림으로 돌려준다 — `getText`와 달리 전체를 메모리에 모으지
   * 않고 그대로 호출자(컨트롤러)에게 흘려보낼 수 있다. 바이너리/대용량 자산(Task
   * 종속파일·Global 모델)의 다운로드 라우트가 쓴다. 없으면 null.
   */
  async getObjectStream(
    bucket: string,
    key: string,
  ): Promise<ObjectStream | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        stream: res.Body as Readable,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
      };
    } catch (e: unknown) {
      if (this.isNotFound(e)) {
        this.logger.debug(`Object not found — ${bucket}/${key}`);
        return null;
      }
      throw this.wrap('read-stream', `${bucket}/${key}`, e);
    }
  }

  /**
   * 시간제한 다운로드 URL을 발급한다. 서명만 로컬에서 계산하므로 네트워크 왕복이 없고,
   * 오브젝트가 실제로 존재하는지도 확인하지 않는다(존재 확인은 호출자의 몫).
   */
  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresSeconds: number,
  ): Promise<string> {
    try {
      return await getSignedUrl(
        this.signingClient,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresSeconds },
      );
    } catch (e: unknown) {
      throw this.wrap('presign', `${bucket}/${key}`, e);
    }
  }

  /** 단건 삭제. 없는 오브젝트에 대해서도 성공으로 취급한다(S3 시맨틱). */
  async delete(bucket: string, key: string): Promise<void> {
    await this.deleteMany(bucket, [key]);
  }

  /** 프리픽스 이하 전체 삭제 — task 제거 시 자산 정리에 쓴다. */
  async deletePrefix(bucket: string, prefix: string): Promise<void> {
    const objects = await this.list(bucket, prefix);
    if (objects.length === 0) return;
    await this.deleteMany(
      bucket,
      objects.map((o) => o.key),
    );
    this.logger.log(
      `Prefix cleared — ${bucket}/${prefix} (${objects.length} objects)`,
    );
  }

  private async deleteMany(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (e: unknown) {
      throw this.wrap('delete', `${bucket} (${keys.length} keys)`, e);
    }
  }

  private isNotFound(e: unknown): boolean {
    const name = (e as { name?: string })?.name;
    const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
  }

  private wrap(
    action: string,
    target: string,
    e: unknown,
  ): InternalServerErrorException {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : JSON.stringify(e);
    this.logger.error(
      `Failed to ${action} object storage ${target}: ${message}`,
    );
    return new InternalServerErrorException(
      `Object storage ${action} failed: ${message}`,
    );
  }
}
