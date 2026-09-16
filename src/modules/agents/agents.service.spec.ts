import { Logger, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { AgentsService } from './agents.service';
import {
  AgentRegistryEntry,
  AgentRegistryEntryDocument,
} from './schemas/agent-registry.schema';
import { ToolsService } from '../tools/tools.service';
import { LlmsService } from '../llms/llms.service';
import { ToolRegistryEntry } from '../tools/schemas/tool-registry.schema';
import { LlmRegistryEntry } from '../llms/schemas/llm-registry.schema';

interface QueryChainSpy {
  sort: jest.Mock;
  skip: jest.Mock;
  limit: jest.Mock;
  exec: jest.Mock;
}

function chain(result: unknown): QueryChainSpy {
  const spy: Partial<QueryChainSpy> = {};
  spy.sort = jest.fn(() => spy);
  spy.skip = jest.fn(() => spy);
  spy.limit = jest.fn(() => spy);
  spy.exec = jest.fn(() => Promise.resolve(result));
  return spy as QueryChainSpy;
}

/** mock 호출 인자를 타입 안전하게 꺼낸다 (jest.Mock.calls는 any[][]) */
function callArg<T>(mock: jest.Mock, callIndex: number, argIndex: number): T {
  const args = mock.mock.calls[callIndex] as unknown[];
  return args[argIndex] as T;
}

type SearchFilter = { $or: Record<string, RegExp>[] };

const AGENT_ID = '4d1f0c2a-6b3e-4a9c-8f21-0c7b5e9a3d10';

function agent(): AgentRegistryEntry {
  return {
    agent_id: AGENT_ID,
    build_revision: 1,
    name: 'triage-agent',
    description: 'routes tickets',
    config: { id: AGENT_ID, tools: [] },
    manifest_fingerprint: 'sha256:abc',
    publisher: 'unknown',
    is_public: false,
    enabled: true,
  };
}

function tool(overrides: Partial<ToolRegistryEntry> = {}): ToolRegistryEntry {
  return {
    tool_id: 'wesad-stress-tft',
    revision: 3,
    version_label: 'federated-v1',
    enabled: true,
    ...overrides,
  } as ToolRegistryEntry;
}

function llm(overrides: Partial<LlmRegistryEntry> = {}): LlmRegistryEntry {
  return {
    llm_id: 'qwen-3.5-4b',
    version: 2,
    version_label: 'q4-k-m',
    enabled: true,
    ...overrides,
  } as LlmRegistryEntry;
}

describe('AgentsService — list/visibility/enabled + AgentConfig rename', () => {
  let service: AgentsService;
  let agentModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let findChain: QueryChainSpy;
  let toolsService: { findByVersionLabel: jest.Mock };
  let llmsService: { findByVersionLabel: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    findChain = chain([agent()]);
    agentModel = {
      find: jest.fn(() => findChain),
      findOne: jest.fn(() => chain(agent())),
      countDocuments: jest.fn(() => chain(1)),
      findOneAndUpdate: jest.fn(() => Promise.resolve(agent())),
    };
    toolsService = {
      findByVersionLabel: jest.fn(() => Promise.resolve(tool())),
    };
    llmsService = { findByVersionLabel: jest.fn(() => Promise.resolve(llm())) };
    service = new AgentsService(
      agentModel as unknown as Model<AgentRegistryEntryDocument>,
      toolsService as unknown as ToolsService,
      llmsService as unknown as LlmsService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findAll', () => {
    it('returns the §7.1 envelope with defaults', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({
        items: [agent()],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(findChain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
      expect(findChain.skip).toHaveBeenCalledWith(0);
    });

    it("narrows to public+enabled entries with publicOnly='true'", async () => {
      await service.findAll({ publicOnly: 'true' });

      expect(agentModel.find).toHaveBeenCalledWith({
        is_public: true,
        enabled: true,
      });
    });

    // docs/issues/0008 — 'false'는 truthy 문자열이라 `if (query.publicOnly)`로 판정하면
    // publicOnly=false가 publicOnly=true와 똑같이 처리돼 비공개 항목이 사라진다.
    it("does not filter when publicOnly='false' (private entries stay included)", async () => {
      await service.findAll({ publicOnly: 'false' });

      expect(agentModel.find).toHaveBeenCalledWith({});
      expect(agentModel.countDocuments).toHaveBeenCalledWith({});
    });

    it('searches name/description only (Agents have no tags)', async () => {
      await service.findAll({ search: 'triage' });

      const filter = callArg<SearchFilter>(agentModel.find, 0, 0);
      expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
        'name',
        'description',
      ]);
    });
  });

  describe('publish', () => {
    it('persists the payload under the renamed config field', async () => {
      await service.publish({
        agent_id: AGENT_ID,
        build_revision: 1,
        name: 'triage-agent',
        config: { id: AGENT_ID, tools: [] },
        manifest_fingerprint: 'sha256:abc',
        is_public: false,
      });

      const update = callArg<Record<string, unknown>>(
        agentModel.findOneAndUpdate,
        0,
        1,
      );
      expect(update.config).toEqual({ id: AGENT_ID, tools: [] });
      expect(update).not.toHaveProperty('manifest');
    });
  });

  describe('resolveConfig (2026-08-08 결정 — camelCase + version_label 부분성공 조립)', () => {
    const dto = {
      llm: {
        source: 'registry' as const,
        modelId: 'qwen-3.5-4b',
        modelVersion: 'q4-k-m',
      },
      tools: [{ toolId: 'wesad-stress-tft', modelVersion: 'federated-v1' }],
    };

    it('resolves llm and tools by (id, version_label) when everything is found and enabled', async () => {
      const result = await service.resolveConfig(dto);

      expect(llmsService.findByVersionLabel).toHaveBeenCalledWith(
        'qwen-3.5-4b',
        'q4-k-m',
      );
      expect(toolsService.findByVersionLabel).toHaveBeenCalledWith(
        'wesad-stress-tft',
        'federated-v1',
      );
      expect(result.llm).toEqual(llm());
      expect(result.tools).toEqual([
        {
          toolId: 'wesad-stress-tft',
          modelVersion: 'federated-v1',
          entry: tool(),
        },
      ]);
      expect(result.errors).toEqual([]);
    });

    it('reports not_found without failing the whole request', async () => {
      llmsService.findByVersionLabel = jest.fn(() => Promise.resolve(null));

      const result = await service.resolveConfig(dto);

      expect(result.llm).toBeNull();
      expect(result.tools[0].entry).toEqual(tool());
      expect(result.errors).toEqual([
        {
          kind: 'llm',
          id: 'qwen-3.5-4b',
          modelVersion: 'q4-k-m',
          reason: 'not_found',
        },
      ]);
    });

    it('treats a disabled tool as unresolved with reason=disabled', async () => {
      toolsService.findByVersionLabel = jest.fn(() =>
        Promise.resolve(tool({ enabled: false })),
      );

      const result = await service.resolveConfig(dto);

      expect(result.tools[0].entry).toBeNull();
      expect(result.errors).toEqual([
        {
          kind: 'tool',
          id: 'wesad-stress-tft',
          modelVersion: 'federated-v1',
          reason: 'disabled',
        },
      ]);
    });

    it('resolves multiple tools independently, keeping request order', async () => {
      toolsService.findByVersionLabel = jest
        .fn()
        .mockResolvedValueOnce(tool({ tool_id: 'wesad-stress-tft' }))
        .mockResolvedValueOnce(null);

      const result = await service.resolveConfig({
        ...dto,
        tools: [
          { toolId: 'wesad-stress-tft', modelVersion: 'federated-v1' },
          { toolId: 'calorie-predictor', modelVersion: 'federated-v2' },
        ],
      });

      expect(result.tools.map((t) => t.toolId)).toEqual([
        'wesad-stress-tft',
        'calorie-predictor',
      ]);
      expect(result.tools[1].entry).toBeNull();
      expect(result.errors).toEqual([
        {
          kind: 'tool',
          id: 'calorie-predictor',
          modelVersion: 'federated-v2',
          reason: 'not_found',
        },
      ]);
    });
  });

  describe('updateVisibility / updateEnabled', () => {
    it('patches is_public only', async () => {
      await service.updateVisibility(AGENT_ID, { is_public: true });

      expect(agentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { agent_id: AGENT_ID },
        { is_public: true },
        { new: true },
      );
    });

    it('patches enabled only', async () => {
      await service.updateEnabled(AGENT_ID, { enabled: false });

      expect(agentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { agent_id: AGENT_ID },
        { enabled: false },
        { new: true },
      );
    });

    it('throws 404 for an unknown agent', async () => {
      agentModel.findOneAndUpdate = jest.fn(() => Promise.resolve(null));

      await expect(
        service.updateVisibility('nope', { is_public: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
