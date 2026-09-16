import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { ToolsService } from './tools.service';
import {
  ToolRegistryEntry,
  ToolRegistryEntryDocument,
} from './schemas/tool-registry.schema';
import { PublishToolDto } from './dto/publish-tool.dto';
import { computeManifestFingerprint } from '../common/manifest-fingerprint.util';

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

function tool(overrides: Partial<ToolRegistryEntry> = {}): ToolRegistryEntry {
  return {
    tool_id: 'mnist-classifier',
    revision: 1,
    framework: 'pytorch',
    tags: ['vision'],
    ...overrides,
  } as ToolRegistryEntry;
}

/** MongoServerError(E11000)를 흉내낸다 — 서비스는 `code === 11000`만 본다. */
class DuplicateKeyError extends Error {
  readonly code = 11000;
  constructor() {
    super('E11000 duplicate key error collection: tool-registry');
  }
}

function publishDto(overrides: Partial<PublishToolDto> = {}): PublishToolDto {
  return {
    tool_id: 'mnist-classifier',
    source_task_id: 'task-1',
    source_model_version: 3,
    manifest: { id: 'mnist-classifier', inputs: ['image'] },
    model_py_source: 'def load_model(package_root): ...',
    wrapper_mode: 'auto',
    framework: 'pytorch',
    is_public: true,
    ...overrides,
  };
}

describe('ToolsService — list/revisions/enabled/publish (architecture-v0.4 §7)', () => {
  let service: ToolsService;
  let toolModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    create: jest.Mock;
  };
  let findChain: QueryChainSpy;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    findChain = chain([tool()]);
    toolModel = {
      find: jest.fn(() => findChain),
      findOne: jest.fn(() => chain(null)),
      countDocuments: jest.fn(() => chain(1)),
      findOneAndUpdate: jest.fn(() => Promise.resolve(tool())),
      create: jest.fn((doc: unknown) => Promise.resolve(doc)),
    };
    service = new ToolsService(
      toolModel as unknown as Model<ToolRegistryEntryDocument>,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findAll', () => {
    it('applies the §7.1 default envelope and pagination', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({ items: [tool()], total: 1, page: 1, limit: 20 });
      expect(findChain.skip).toHaveBeenCalledWith(0);
      expect(findChain.limit).toHaveBeenCalledWith(20);
      expect(toolModel.find).toHaveBeenCalledWith({});
    });

    it('computes skip from page/limit', async () => {
      await service.findAll({ page: 3, limit: 5 });

      expect(findChain.skip).toHaveBeenCalledWith(10);
      expect(findChain.limit).toHaveBeenCalledWith(5);
    });

    it('builds a case-insensitive $or filter for search over id/description/tags', async () => {
      await service.findAll({ search: 'MNIST' });

      const filter = callArg<SearchFilter>(toolModel.find, 0, 0);
      expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
        'tool_id',
        'description',
        'tags',
      ]);
      const pattern = filter.$or[0].tool_id;
      expect(pattern.flags).toContain('i');
      expect(pattern.test('mnist-classifier')).toBe(true);
    });

    it('escapes regex metacharacters in the search term', async () => {
      await service.findAll({ search: 'a.b*' });

      const filter = callArg<SearchFilter>(toolModel.find, 0, 0);
      expect(filter.$or[0].tool_id.test('axbyy')).toBe(false);
      expect(filter.$or[0].tool_id.test('a.b**')).toBe(true);
    });

    it('applies tags as OR match and framework as equality, plus publicOnly', async () => {
      await service.findAll({
        tags: ['vision', 'nlp'],
        framework: 'pytorch',
        publicOnly: 'true',
      });

      expect(toolModel.find).toHaveBeenCalledWith({
        is_public: true,
        enabled: true,
        framework: 'pytorch',
        tags: { $in: ['vision', 'nlp'] },
      });
    });

    // docs/issues/0008 — 'false'는 truthy 문자열이라 `if (query.publicOnly)`로 판정하면
    // publicOnly=false가 publicOnly=true와 똑같이 처리돼 비공개 항목이 사라진다.
    it("does not filter when publicOnly='false' (private entries stay included)", async () => {
      await service.findAll({ publicOnly: 'false' });

      expect(toolModel.find).toHaveBeenCalledWith({});
      expect(toolModel.countDocuments).toHaveBeenCalledWith({});
    });

    it('does not filter when publicOnly is omitted', async () => {
      await service.findAll({ framework: 'pytorch' });

      expect(toolModel.find).toHaveBeenCalledWith({ framework: 'pytorch' });
    });

    it('counts with the same filter used for the page query', async () => {
      await service.findAll({ framework: 'tensorflow' });

      expect(toolModel.countDocuments).toHaveBeenCalledWith({
        framework: 'tensorflow',
      });
    });
  });

  describe('findRevisions', () => {
    it('returns revisions sorted descending', async () => {
      findChain = chain([tool({ revision: 2 }), tool({ revision: 1 })]);
      toolModel.find = jest.fn(() => findChain);

      const result = await service.findRevisions('mnist-classifier');

      expect(toolModel.find).toHaveBeenCalledWith({
        tool_id: 'mnist-classifier',
      });
      expect(findChain.sort).toHaveBeenCalledWith({ revision: -1 });
      expect(result).toHaveLength(2);
    });

    it('throws 404 when no revision exists', async () => {
      findChain = chain([]);
      toolModel.find = jest.fn(() => findChain);

      await expect(service.findRevisions('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findByVersionLabel (2026-08-08 결정 — Agent Config resolve 전용)', () => {
    it('queries by (tool_id, version_label) and sorts by latest revision', async () => {
      toolModel.findOne = jest.fn(() =>
        chain(tool({ version_label: 'federated-v1' })),
      );

      const result = await service.findByVersionLabel(
        'mnist-classifier',
        'federated-v1',
      );

      expect(toolModel.findOne).toHaveBeenCalledWith({
        tool_id: 'mnist-classifier',
        version_label: 'federated-v1',
      });
      expect(result).toEqual(tool({ version_label: 'federated-v1' }));
    });

    it('returns null instead of throwing when no match exists', async () => {
      toolModel.findOne = jest.fn(() => chain(null));

      const result = await service.findByVersionLabel('nope', 'v9');

      expect(result).toBeNull();
    });
  });

  describe('publish (architecture-v0.4 §7.2 + docs/issues/0007)', () => {
    it('assigns revision 1 when no revision exists yet', async () => {
      const created = (await service.publish(
        publishDto(),
      )) as unknown as Record<string, unknown>;

      expect(toolModel.findOne).toHaveBeenCalledWith({
        tool_id: 'mnist-classifier',
      });
      expect(created.revision).toBe(1);
      expect(toolModel.create).toHaveBeenCalledTimes(1);
    });

    it('assigns latest revision + 1 when prior revisions exist', async () => {
      toolModel.findOne = jest.fn(() => chain(tool({ revision: 4 })));

      const created = (await service.publish(
        publishDto(),
      )) as unknown as Record<string, unknown>;

      expect(created.revision).toBe(5);
    });

    it('stores the canonical manifest fingerprint (key order independent)', async () => {
      const created = (await service.publish(
        publishDto({ manifest: { inputs: ['image'], id: 'mnist-classifier' } }),
      )) as unknown as Record<string, unknown>;

      expect(created.manifest_fingerprint).toBe(
        computeManifestFingerprint({
          id: 'mnist-classifier',
          inputs: ['image'],
        }),
      );
    });

    it('defaults optional fields instead of writing undefined', async () => {
      const created = (await service.publish(
        publishDto(),
      )) as unknown as Record<string, unknown>;

      expect(created.source_model_py_source).toBe('');
      expect(created.description).toBe('');
      expect(created.tags).toEqual([]);
      expect(created.publisher).toBe('unknown');
      expect(created.version_label).toBe('');
      // wrapper_mode는 표시 메타데이터로 그대로 저장된다(저장 로직의 분기 조건이 아님)
      expect(created.wrapper_mode).toBe('auto');
    });

    it('stores an explicit version_label', async () => {
      const created = (await service.publish(
        publishDto({ version_label: 'federated-v1' }),
      )) as unknown as Record<string, unknown>;

      expect(created.version_label).toBe('federated-v1');
    });

    it('retries once on a duplicate (tool_id, revision) collision', async () => {
      toolModel.findOne = jest
        .fn()
        .mockReturnValueOnce(chain(tool({ revision: 1 })))
        .mockReturnValueOnce(chain(tool({ revision: 2 })));
      toolModel.create = jest
        .fn()
        .mockRejectedValueOnce(new DuplicateKeyError())
        .mockImplementationOnce((doc: unknown) => Promise.resolve(doc));

      const created = (await service.publish(
        publishDto(),
      )) as unknown as Record<string, unknown>;

      expect(toolModel.create).toHaveBeenCalledTimes(2);
      expect(created.revision).toBe(3);
    });

    it('gives up after the single retry', async () => {
      toolModel.create = jest.fn(() => Promise.reject(new DuplicateKeyError()));

      await expect(service.publish(publishDto())).rejects.toMatchObject({
        code: 11000,
      });
      expect(toolModel.create).toHaveBeenCalledTimes(2);
    });

    it('does not retry on unrelated write errors', async () => {
      toolModel.create = jest.fn(() => Promise.reject(new Error('network')));

      await expect(service.publish(publishDto())).rejects.toThrow('network');
      expect(toolModel.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-object manifest before touching Mongo', async () => {
      await expect(
        service.publish(
          publishDto({ manifest: [] as unknown as Record<string, unknown> }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(toolModel.create).not.toHaveBeenCalled();
    });

    it('rejects a blank model_py_source', async () => {
      await expect(
        service.publish(publishDto({ model_py_source: '   ' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(toolModel.create).not.toHaveBeenCalled();
    });
  });

  describe('updateEnabled', () => {
    it('patches only the enabled field and returns the updated doc', async () => {
      await service.updateEnabled('mnist-classifier', { enabled: false });

      expect(toolModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tool_id: 'mnist-classifier' },
        { enabled: false },
        { new: true },
      );
    });

    it('throws 404 for an unknown tool', async () => {
      toolModel.findOneAndUpdate = jest.fn(() => Promise.resolve(null));

      await expect(
        service.updateEnabled('nope', { enabled: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
