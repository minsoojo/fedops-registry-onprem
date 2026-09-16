import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  LlmRegistryEntry,
  LlmRegistryEntryDocument,
  LlmSourceRef,
} from './schemas/llm-registry.schema';
import { PublishLlmDto } from './dto/publish-llm.dto';
import { ListLlmsQueryDto } from './dto/list-llms-query.dto';
import { UpdateLlmVisibilityDto } from './dto/update-llm-visibility.dto';
import { UpdateLlmEnabledDto } from './dto/update-llm-enabled.dto';
import { S3RegistryService } from '../storage/s3-registry.service';
import {
  PaginatedResult,
  buildSearchOr,
  resolvePagination,
} from '../common/registry-list.util';

/** search 대상 필드 (architecture-v0.4.md §7.1 — LLM엔 tags가 없어 id/이름/설명) */
const LLM_SEARCH_FIELDS = ['llm_id', 'display_name', 'description'];

/** presigned 다운로드 URL 유효기간 */
export const LLM_DOWNLOAD_URL_TTL_SECONDS = 300;

/** registry 소스에서 호출자가 파일명을 주지 않았을 때 쓰는 기본 오브젝트 파일명 */
export const DEFAULT_LLM_BINARY_FILENAME = 'model.bin';

export interface LlmDownloadUrl {
  llm_id: string;
  version: number;
  download_url: string;
  expires_in: number;
}

/**
 * LLM 등록/조회 서비스 (architecture-v0.3.md §13.2 / architecture-v0.4.md §7.4).
 *
 * `huggingface` 소스는 외부 참조만 저장하는 순수 Mongo insert이고, `registry` 소스는
 * 바이너리를 전용 MinIO에 올린 뒤 그 키를 `ref.s3_key`로 저장한다.
 *
 * NOTE: `POST /v1/registry/llms` 라우트는 아직 JSON body만 받으므로(멀티파트 미배선)
 * registry 소스 발행은 이 서비스를 직접 호출하는 경로에서만 성립한다. HTTP로 들어온
 * registry 소스 요청은 바이너리가 없어 400으로 거부된다 — 업로드 전송 방식 결정은
 * 별도 과제다.
 */
@Injectable()
export class LlmsService {
  private readonly logger = new Logger(LlmsService.name);

  constructor(
    @InjectModel(LlmRegistryEntry.name)
    private readonly llmModel: Model<LlmRegistryEntryDocument>,
    private readonly s3RegistryService: S3RegistryService,
  ) {}

  /**
   * LLM 목록 조회 — architecture-v0.4.md §7.1 공통 규칙(search/page/limit/publicOnly)
   * + LLM 전용 source 필터. 응답은 공통 봉투로 감싼다.
   */
  async findAll(
    query: ListLlmsQueryDto = {},
  ): Promise<PaginatedResult<LlmRegistryEntry>> {
    const { page, limit, skip } = resolvePagination(query);
    const filter: FilterQuery<LlmRegistryEntryDocument> = {};

    // publicOnly는 'true'|'false' 문자열이다 (docs/issues/0008) — 'false'도 truthy이므로
    // 반드시 값 비교로 판정한다.
    if (query.publicOnly === 'true') {
      filter.is_public = true;
      filter.enabled = true;
    }
    if (query.source) {
      filter['ref.source'] = query.source;
    }
    const search = buildSearchOr(query.search, LLM_SEARCH_FIELDS);
    if (search) {
      Object.assign(filter, search);
    }

    const [items, total] = await Promise.all([
      this.llmModel
        .find(filter)
        .sort({ llm_id: 1, version: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.llmModel.countDocuments(filter).exec(),
    ]);

    this.logger.debug(
      `findAll() returned ${items.length}/${total} llms (page=${page} limit=${limit})`,
    );
    return { items, total, page, limit };
  }

  async findOne(llmId: string): Promise<LlmRegistryEntry> {
    const entry = await this.llmModel
      .findOne({ llm_id: llmId })
      .sort({ version: -1 })
      .exec();
    if (!entry) {
      throw new NotFoundException(`LLM not found: ${llmId}`);
    }
    return entry;
  }

  /**
   * `version_label`(표시용 문자열, 예: 'q4-k-m' 양자화 표기)로 조회한다. Agent Config
   * 조립(resolve) 전용 — ToolsService.findByVersionLabel과 동일한 이유로 예외 대신
   * null을 돌려준다.
   */
  async findByVersionLabel(
    llmId: string,
    versionLabel: string,
  ): Promise<LlmRegistryEntry | null> {
    return this.llmModel
      .findOne({ llm_id: llmId, version_label: versionLabel })
      .sort({ version: -1 })
      .exec();
  }

  /**
   * LLM 등록. `registry` 소스만 오브젝트 스토리지를 거치고, `huggingface` 소스는
   * 참조(repo_id/filename/revision)만 저장하는 순수 Mongo insert다.
   */
  async publish(
    dto: PublishLlmDto,
    binary?: Buffer,
  ): Promise<LlmRegistryEntry> {
    const ref: LlmSourceRef =
      dto.source === 'registry'
        ? { source: 'registry', s3_key: await this.uploadBinary(dto, binary) }
        : {
            source: 'huggingface',
            repo_id: dto.repo_id,
            filename: dto.filename,
            revision: dto.revision,
          };

    const created = await this.llmModel.create({
      llm_id: dto.llm_id,
      version: dto.version,
      display_name: dto.display_name,
      ref,
      description: dto.description ?? '',
      version_label: dto.version_label ?? '',
      is_public: dto.is_public,
    });

    this.logger.log(
      `publish() llm_id=${dto.llm_id} version=${dto.version} source=${dto.source}`,
    );
    return created;
  }

  /** registry 소스 전용 — 바이너리를 올리고 ref.s3_key로 쓸 오브젝트 키를 돌려준다. */
  private async uploadBinary(
    dto: PublishLlmDto,
    binary?: Buffer,
  ): Promise<string> {
    if (!binary || binary.length === 0) {
      throw new BadRequestException(
        `source='registry' requires the model binary in the request, but none was received for ${dto.llm_id} (use source='huggingface' to register an external reference)`,
      );
    }
    return this.s3RegistryService.uploadLlmBinary(
      dto.llm_id,
      dto.version,
      binary,
      dto.filename ?? DEFAULT_LLM_BINARY_FILENAME,
    );
  }

  async updateVisibility(
    llmId: string,
    dto: UpdateLlmVisibilityDto,
  ): Promise<LlmRegistryEntry> {
    const entry = await this.llmModel.findOneAndUpdate(
      { llm_id: llmId },
      { is_public: dto.is_public },
      { new: true },
    );
    if (!entry) {
      throw new NotFoundException(`LLM not found: ${llmId}`);
    }
    this.logger.log(
      `updateVisibility() llm_id=${llmId} is_public=${dto.is_public}`,
    );
    return entry;
  }

  async updateEnabled(
    llmId: string,
    dto: UpdateLlmEnabledDto,
  ): Promise<LlmRegistryEntry> {
    const entry = await this.llmModel.findOneAndUpdate(
      { llm_id: llmId },
      { enabled: dto.enabled },
      { new: true },
    );
    if (!entry) {
      throw new NotFoundException(`LLM not found: ${llmId}`);
    }
    this.logger.log(`updateEnabled() llm_id=${llmId} enabled=${dto.enabled}`);
    return entry;
  }

  /**
   * registry-hosted LLM 바이너리의 presigned 다운로드 URL 발급
   * (architecture-v0.4.md §7.3).
   *
   * huggingface 소스는 클라이언트가 HF Hub에 직접 접근하므로 이 라우트가 필요 없다 —
   * 잘못 호출한 것을 알 수 있게 400으로 되돌려준다.
   */
  async getDownloadUrl(llmId: string): Promise<LlmDownloadUrl> {
    const entry = await this.findOne(llmId);
    if (entry.ref.source !== 'registry') {
      throw new BadRequestException(
        `This route is for registry-source LLMs only: ${llmId} has source='${entry.ref.source}' (access the HF Hub directly)`,
      );
    }
    if (!entry.ref.s3_key) {
      throw new NotFoundException(
        `LLM binary reference is missing (ref.s3_key not set): ${llmId}`,
      );
    }

    this.logger.log(
      `getDownloadUrl() llm_id=${llmId} version=${entry.version} s3_key=${entry.ref.s3_key}`,
    );
    const url = await this.s3RegistryService.getPresignedDownloadUrl(
      entry.ref.s3_key,
      LLM_DOWNLOAD_URL_TTL_SECONDS,
    );
    return {
      llm_id: entry.llm_id,
      version: entry.version,
      download_url: url,
      expires_in: LLM_DOWNLOAD_URL_TTL_SECONDS,
    };
  }
}
