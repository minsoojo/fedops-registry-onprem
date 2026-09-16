import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './config/env.validation';
import { RegistryModule } from './modules/registry.module';
import { TaskAssetsModule } from './modules/task-assets/task-assets.module';
import { GlobalModelsModule } from './modules/global-models/global-models.module';
import { TaskArchiveModule } from './modules/task-archive/task-archive.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
    }),
    // Registry 전용 MongoDB. Server-Manager의 Task 도메인 MongoDB와 코드 패턴은
    // 같지만 물리적으로 분리된 별도 인스턴스를 가리킨다
    // (docs/architecture/architecture-v0.4.md §2).
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI') ?? 'mongodb://localhost:27017',
        dbName: config.get<string>('MONGODB_DATABASE') ?? 'fedops-registry',
      }),
    }),
    // Tool/LLM/Agent 카탈로그·발행 도메인. Server-Manager
    // `src/modules/registry/`에서 이관됨 (architecture-v0.4.md §2).
    RegistryModule,
    // FedOps1 전용 — FedOps2에서 Server-Manager 전용 MinIO가 소유하던 Task 종속파일/
    // Global 모델을 이 Registry로 병합했다. FedOps2-Registry에는 이 두 모듈이 없다
    // (README 참고, architecture-v0.4.md는 FedOps2 기준이라 갱신하지 않는다).
    TaskAssetsModule,
    GlobalModelsModule,
    // task-assets/global-models를 조합해 taskId 하나의 산출물 전체를 ZIP으로 묶어준다.
    TaskArchiveModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
