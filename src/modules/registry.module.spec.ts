import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { RegistryModule } from './registry.module';
import { ObjectStorageService } from './storage/object-storage.service';
import { S3RegistryService } from './storage/s3-registry.service';
import { ToolRegistryEntry } from './tools/schemas/tool-registry.schema';
import { LlmRegistryEntry } from './llms/schemas/llm-registry.schema';
import { AgentRegistryEntry } from './agents/schemas/agent-registry.schema';

/**
 * RegistryModule 배선·라우트 계약 테스트.
 *
 * 개별 서비스 로직은 각 `*.service.spec.ts`가 검증하고, 이 스펙은 모듈 그래프가 실제로
 * 조립되는지(DI 해석)와 노출되는 URL 표면이 architecture-v0.4.md §7.3 목록과 일치하는지를
 * 본다. Mongo 연결 없이 돌도록 모델 토큰만 스텁으로 대체한다.
 */

/** architecture-v0.4.md §7.3 엔드포인트 전체 목록. */
const EXPECTED_ROUTES = [
  'GET /v1/registry/tools',
  'GET /v1/registry/tools/:toolId',
  'GET /v1/registry/tools/:toolId/revisions',
  'POST /v1/registry/tools',
  'PATCH /v1/registry/tools/:toolId/visibility',
  'PATCH /v1/registry/tools/:toolId/enabled',
  'GET /v1/registry/llms',
  'GET /v1/registry/llms/:llmId',
  'GET /v1/registry/llms/:llmId/download',
  'POST /v1/registry/llms',
  'PATCH /v1/registry/llms/:llmId/visibility',
  'PATCH /v1/registry/llms/:llmId/enabled',
  'GET /v1/registry/agents',
  'GET /v1/registry/agents/:agentId',
  'POST /v1/registry/agents/resolve',
  'POST /v1/registry/agents',
  'PATCH /v1/registry/agents/:agentId/visibility',
  'PATCH /v1/registry/agents/:agentId/enabled',
];

describe('RegistryModule', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), RegistryModule],
    })
      .overrideProvider(getModelToken(ToolRegistryEntry.name))
      .useValue({})
      .overrideProvider(getModelToken(LlmRegistryEntry.name))
      .useValue({})
      .overrideProvider(getModelToken(AgentRegistryEntry.name))
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts와 같은 URI 버저닝 — 컨트롤러의 version: '1'이 /v1 프리픽스로 풀린다.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('wires the object storage layer', () => {
    // S3RegistryService가 Registry 자체의 ObjectStorageService를 주입받는다
    // (architecture-v0.4.md §2 — Server-Manager 인스턴스 공유 아님).
    expect(app.get(ObjectStorageService)).toBeInstanceOf(ObjectStorageService);
    expect(app.get(S3RegistryService)).toBeInstanceOf(S3RegistryService);
  });

  it('exposes exactly the v0.4 §7.3 endpoints', () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const server = app.getHttpAdapter().getInstance() as {
      router?: { stack: Layer[] };
      _router?: { stack: Layer[] };
    };
    const stack = (server.router ?? server._router)?.stack ?? [];
    const routes = stack
      .filter((layer): layer is Required<Layer> => Boolean(layer.route))
      .map(
        (layer) =>
          `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`,
      );

    expect(routes.sort()).toEqual([...EXPECTED_ROUTES].sort());
  });
});
