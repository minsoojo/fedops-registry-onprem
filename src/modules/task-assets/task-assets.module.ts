import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TaskAssetsController } from './task-assets.controller';
import { TaskAssetsService } from './task-assets.service';

/**
 * Task 종속파일 저장 도메인 — FedOps1 전용(FedOps2-Registry에는 없다).
 *
 * Mongo 스키마가 없다 — Server-Manager `TaskAssetsService`와 마찬가지로 오브젝트
 * 스토리지 프리픽스 소유권만 있는 얇은 레이어다.
 */
@Module({
  imports: [StorageModule],
  controllers: [TaskAssetsController],
  providers: [TaskAssetsService],
  exports: [TaskAssetsService],
})
export class TaskAssetsModule {}
