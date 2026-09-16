import { Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';
import { S3RegistryService } from './s3-registry.service';

/**
 * 오브젝트 스토리지(Registry 전용 MinIO) 접근을 한 곳으로 모은다.
 *
 * `ObjectStorageService`는 Server-Manager의 동명 서비스를 복제한 범용 클라이언트이고,
 * `S3RegistryService`는 그 위에 LLM 바이너리(`fedops-llms` 버킷)에 특화된 키 규칙을
 * 얹는 얇은 레이어다 (docs/architecture/architecture-v0.4.md §2).
 */
@Module({
  providers: [ObjectStorageService, S3RegistryService],
  exports: [ObjectStorageService, S3RegistryService],
})
export class StorageModule {}
