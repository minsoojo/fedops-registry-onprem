import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { GlobalModelsController } from './global-models.controller';
import { GlobalModelsService } from './global-models.service';

/**
 * Global 모델 저장 도메인 — FedOps1 전용(FedOps2-Registry에는 없다).
 *
 * Mongo 스키마가 없다 — `TaskAssetsModule`과 마찬가지로 오브젝트 스토리지 프리픽스
 * 소유권만 있는 얇은 레이어다.
 */
@Module({
  imports: [StorageModule],
  controllers: [GlobalModelsController],
  providers: [GlobalModelsService],
  exports: [GlobalModelsService],
})
export class GlobalModelsModule {}
