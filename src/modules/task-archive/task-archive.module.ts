import { Module } from '@nestjs/common';
import { TaskAssetsModule } from '../task-assets/task-assets.module';
import { GlobalModelsModule } from '../global-models/global-models.module';
import { TaskArchiveController } from './task-archive.controller';
import { TaskArchiveService } from './task-archive.service';

/**
 * `task-assets`/`global-models`를 조합하는 상위 레이어 — FedOps1 전용
 * (FedOps2-Registry에는 없다). 두 모듈 자체는 서로를 몰라야 하므로, 조합은
 * 이 모듈에서만 이루어진다.
 */
@Module({
  imports: [TaskAssetsModule, GlobalModelsModule],
  controllers: [TaskArchiveController],
  providers: [TaskArchiveService],
})
export class TaskArchiveModule {}
