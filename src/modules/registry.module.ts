import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ToolRegistryEntry,
  ToolRegistryEntrySchema,
} from './tools/schemas/tool-registry.schema';
import { ToolsController } from './tools/tools.controller';
import { ToolsService } from './tools/tools.service';
import {
  LlmRegistryEntry,
  LlmRegistryEntrySchema,
} from './llms/schemas/llm-registry.schema';
import { LlmsController } from './llms/llms.controller';
import { LlmsService } from './llms/llms.service';
import {
  AgentRegistryEntry,
  AgentRegistryEntrySchema,
} from './agents/schemas/agent-registry.schema';
import { AgentsController } from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { StorageModule } from './storage/storage.module';

/**
 * Registry 모듈 — Tool/LLM/Agent 카탈로그·발행
 * (컬렉션·필드 정의는 architecture-v0.3.md §13~§18, 소유권·배포는 v0.4 §2·§7).
 *
 * v0.4에서 Server-Manager 내장 모듈이 아니라 **FedOps2-Registry 프로세스의 도메인
 * 모듈**이 되었다 — 도메인 로직은 그대로이고 실행 프로세스만 이동했다.
 *
 * ToolsService/AgentsService는 오브젝트 스토리지에 의존하지 않는다(Mongo embed만
 * 사용) — LlmsService만 registry-hosted 바이너리 업로드를 위해 `S3RegistryService`에
 * 의존하며, 그 서비스는 `StorageModule`이 제공한다.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ToolRegistryEntry.name, schema: ToolRegistryEntrySchema },
      { name: LlmRegistryEntry.name, schema: LlmRegistryEntrySchema },
      { name: AgentRegistryEntry.name, schema: AgentRegistryEntrySchema },
    ]),
    StorageModule,
  ],
  controllers: [ToolsController, LlmsController, AgentsController],
  providers: [ToolsService, LlmsService, AgentsService],
  exports: [ToolsService, LlmsService, AgentsService],
})
export class RegistryModule {}
