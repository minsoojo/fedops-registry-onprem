import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import {
  DEFAULT_LLM_BINARY_FILENAME,
  LLM_DOWNLOAD_URL_TTL_SECONDS,
  LlmsService,
} from './llms.service';
import { PublishLlmDto } from './dto/publish-llm.dto';
import {
  LlmRegistryEntry,
  LlmRegistryEntryDocument,
  LlmSourceKind,
} from './schemas/llm-registry.schema';
import { S3RegistryService } from '../storage/s3-registry.service';

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

function llm(
  source: LlmSourceKind,
  s3Key?: string,
  overrides: Partial<LlmRegistryEntry> = {},
): LlmRegistryEntry {
  return {
    llm_id: 'llama-3-8b',
    version: 2,
    display_name: 'Llama 3 8B',
    ref: { source, s3_key: s3Key },
    ...overrides,
  } as LlmRegistryEntry;
}

function hfDto(overrides: Partial<PublishLlmDto> = {}): PublishLlmDto {
  return {
    llm_id: 'llama-3-8b',
    version: 1,
    display_name: 'Llama 3 8B',
    source: 'huggingface',
    repo_id: 'meta-llama/Meta-Llama-3-8B',
    filename: 'model.safetensors',
    revision: 'main',
    is_public: true,
    ...overrides,
  };
}

describe('LlmsService — list/visibility/enabled/download/publish (architecture-v0.4 §7)', () => {
  let service: LlmsService;
  let llmModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    create: jest.Mock;
  };
  let s3: { getPresignedDownloadUrl: jest.Mock; uploadLlmBinary: jest.Mock };
  let findChain: QueryChainSpy;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    findChain = chain([llm('registry', 'llms/llama-3-8b/v2.bin')]);
    llmModel = {
      find: jest.fn(() => findChain),
      findOne: jest.fn(() => chain(llm('registry', 'llms/llama-3-8b/v2.bin'))),
      countDocuments: jest.fn(() => chain(1)),
      findOneAndUpdate: jest.fn(() =>
        Promise.resolve(llm('registry', 'llms/llama-3-8b/v2.bin')),
      ),
      create: jest.fn((doc: unknown) => Promise.resolve(doc)),
    };
    s3 = {
      getPresignedDownloadUrl: jest.fn(() =>
        Promise.resolve('https://minio.example/presigned'),
      ),
      uploadLlmBinary: jest.fn(() => Promise.resolve('llama-3-8b/1/model.bin')),
    };
    service = new LlmsService(
      llmModel as unknown as Model<LlmRegistryEntryDocument>,
      s3 as unknown as S3RegistryService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findAll', () => {
    it('returns the §7.1 envelope with defaults', async () => {
      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.items).toHaveLength(1);
      expect(findChain.skip).toHaveBeenCalledWith(0);
    });

    it('filters on the embedded ref.source path', async () => {
      await service.findAll({ source: 'huggingface', publicOnly: 'true' });

      expect(llmModel.find).toHaveBeenCalledWith({
        is_public: true,
        enabled: true,
        'ref.source': 'huggingface',
      });
    });

    // docs/issues/0008 — 'false'는 truthy 문자열이라 `if (query.publicOnly)`로 판정하면
    // publicOnly=false가 publicOnly=true와 똑같이 처리돼 비공개 항목이 사라진다.
    it("does not filter when publicOnly='false' (private entries stay included)", async () => {
      await service.findAll({ publicOnly: 'false' });

      expect(llmModel.find).toHaveBeenCalledWith({});
      expect(llmModel.countDocuments).toHaveBeenCalledWith({});
    });

    it('searches id/display_name/description case-insensitively', async () => {
      await service.findAll({ search: 'llama' });

      const filter = callArg<SearchFilter>(llmModel.find, 0, 0);
      expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
        'llm_id',
        'display_name',
        'description',
      ]);
      expect(filter.$or[1].display_name.test('Llama 3 8B')).toBe(true);
    });
  });

  describe('getDownloadUrl', () => {
    it('presigns the s3_key for registry-source entries', async () => {
      const result = await service.getDownloadUrl('llama-3-8b');

      expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith(
        'llms/llama-3-8b/v2.bin',
        LLM_DOWNLOAD_URL_TTL_SECONDS,
      );
      expect(result).toEqual({
        llm_id: 'llama-3-8b',
        version: 2,
        download_url: 'https://minio.example/presigned',
        expires_in: LLM_DOWNLOAD_URL_TTL_SECONDS,
      });
    });

    it('rejects huggingface-source entries with 400 before touching S3', async () => {
      llmModel.findOne = jest.fn(() => chain(llm('huggingface')));

      await expect(service.getDownloadUrl('llama-3-8b')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(s3.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws 404 when a registry entry has no s3_key', async () => {
      llmModel.findOne = jest.fn(() => chain(llm('registry')));

      await expect(service.getDownloadUrl('llama-3-8b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('propagates presign failures from the storage layer', async () => {
      s3.getPresignedDownloadUrl = jest.fn(() => {
        throw new InternalServerErrorException('presign failed');
      });

      await expect(service.getDownloadUrl('llama-3-8b')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('findByVersionLabel (2026-08-08 결정 — Agent Config resolve 전용)', () => {
    it('queries by (llm_id, version_label) and sorts by latest version', async () => {
      llmModel.findOne = jest.fn(() =>
        chain(
          llm('registry', 'llms/llama-3-8b/v2.bin', {
            version_label: 'q4-k-m',
          }),
        ),
      );

      const result = await service.findByVersionLabel('llama-3-8b', 'q4-k-m');

      expect(llmModel.findOne).toHaveBeenCalledWith({
        llm_id: 'llama-3-8b',
        version_label: 'q4-k-m',
      });
      expect(result?.version_label).toBe('q4-k-m');
    });

    it('returns null instead of throwing when no match exists', async () => {
      llmModel.findOne = jest.fn(() => chain(null));

      const result = await service.findByVersionLabel('nope', 'v9');

      expect(result).toBeNull();
    });
  });

  describe('publish (architecture-v0.4 §7.4)', () => {
    it('stores a huggingface reference without touching object storage', async () => {
      const created = (await service.publish(hfDto())) as unknown as Record<
        string,
        unknown
      >;

      expect(s3.uploadLlmBinary).not.toHaveBeenCalled();
      expect(llmModel.create).toHaveBeenCalledTimes(1);
      expect(created.ref).toEqual({
        source: 'huggingface',
        repo_id: 'meta-llama/Meta-Llama-3-8B',
        filename: 'model.safetensors',
        revision: 'main',
      });
      expect(created.description).toBe('');
      expect(created.version_label).toBe('');
    });

    it('stores an explicit version_label', async () => {
      const created = (await service.publish(
        hfDto({ version_label: 'q4-k-m' }),
      )) as unknown as Record<string, unknown>;

      expect(created.version_label).toBe('q4-k-m');
    });

    it('uploads the binary and stores the returned key for registry source', async () => {
      const binary = Buffer.from('weights');

      const created = (await service.publish(
        hfDto({ source: 'registry', filename: undefined }),
        binary,
      )) as unknown as Record<string, unknown>;

      expect(s3.uploadLlmBinary).toHaveBeenCalledWith(
        'llama-3-8b',
        1,
        binary,
        DEFAULT_LLM_BINARY_FILENAME,
      );
      expect(created.ref).toEqual({
        source: 'registry',
        s3_key: 'llama-3-8b/1/model.bin',
      });
    });

    it('rejects a registry-source publish with no binary (route is JSON-only today)', async () => {
      await expect(
        service.publish(hfDto({ source: 'registry' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(llmModel.create).not.toHaveBeenCalled();
    });
  });

  describe('updateVisibility / updateEnabled', () => {
    it('patches is_public only', async () => {
      await service.updateVisibility('llama-3-8b', { is_public: true });

      expect(llmModel.findOneAndUpdate).toHaveBeenCalledWith(
        { llm_id: 'llama-3-8b' },
        { is_public: true },
        { new: true },
      );
    });

    it('patches enabled only', async () => {
      await service.updateEnabled('llama-3-8b', { enabled: false });

      expect(llmModel.findOneAndUpdate).toHaveBeenCalledWith(
        { llm_id: 'llama-3-8b' },
        { enabled: false },
        { new: true },
      );
    });

    it('throws 404 for an unknown llm', async () => {
      llmModel.findOneAndUpdate = jest.fn(() => Promise.resolve(null));

      await expect(
        service.updateEnabled('nope', { enabled: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
