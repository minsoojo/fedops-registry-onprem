import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  ToolRegistryEntry,
  ToolRegistryEntryDocument,
} from './schemas/tool-registry.schema';
import { PublishToolDto } from './dto/publish-tool.dto';
import { UpdateToolVisibilityDto } from './dto/update-tool-visibility.dto';
import { UpdateToolEnabledDto } from './dto/update-tool-enabled.dto';
import { ListToolsQueryDto } from './dto/list-tools-query.dto';
import {
  PaginatedResult,
  buildSearchOr,
  resolvePagination,
} from '../common/registry-list.util';
import {
  computeManifestFingerprint,
  isDuplicateKeyError,
} from '../common/manifest-fingerprint.util';

/** search 대상 필드 (architecture-v0.4.md §7.1 — 이름/설명/태그) */
const TOOL_SEARCH_FIELDS = ['tool_id', 'description', 'tags'];

/**
 * 인증 모델 연동 전까지의 임시 publisher (architecture-v0.3.md §19).
 * AgentsService.publish()와 동일한 처리를 따른다.
 */
const UNKNOWN_PUBLISHER = 'unknown';

/**
 * Tool 발행/조회 서비스.
 *
 * publish()는 auto/manual로 분기하지 않는다 (architecture-v0.4.md §7.2) — manifest와
 * model.py를 어떻게 만들었는지는 호출자(Server-Manager)의 책임이고, Registry는 받은
 * 콘텐츠를 구조 검증 → fingerprint 계산 → revision 할당 → 저장하는 한 경로만 가진다.
 * `model_py_source`의 훅 시그니처 검증(load_model/prepare/predict)은 의도적으로 제외했다
 * (docs/future/registry.md에 후속 항목으로 기록됨).
 */
@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    @InjectModel(ToolRegistryEntry.name)
    private readonly toolModel: Model<ToolRegistryEntryDocument>,
  ) {}

  /**
   * Tool 목록 조회 — architecture-v0.4.md §7.1 공통 규칙(search/page/limit/publicOnly)
   * + Tool 전용 필터(tags/framework). 응답은 공통 봉투로 감싼다.
   */
  async findAll(
    query: ListToolsQueryDto = {},
  ): Promise<PaginatedResult<ToolRegistryEntry>> {
    const { page, limit, skip } = resolvePagination(query);
    const filter: FilterQuery<ToolRegistryEntryDocument> = {};

    // publicOnly는 'true'|'false' 문자열이다 (docs/issues/0008) — 'false'도 truthy이므로
    // 반드시 값 비교로 판정한다.
    if (query.publicOnly === 'true') {
      filter.is_public = true;
      filter.enabled = true;
    }
    if (query.framework) {
      filter.framework = query.framework;
    }
    if (query.tags?.length) {
      filter.tags = { $in: query.tags };
    }
    const search = buildSearchOr(query.search, TOOL_SEARCH_FIELDS);
    if (search) {
      Object.assign(filter, search);
    }

    const [items, total] = await Promise.all([
      this.toolModel
        .find(filter)
        .sort({ tool_id: 1, revision: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.toolModel.countDocuments(filter).exec(),
    ]);

    this.logger.debug(
      `findAll() returned ${items.length}/${total} tools (page=${page} limit=${limit})`,
    );
    return { items, total, page, limit };
  }

  /**
   * 특정 tool_id의 전체 revision 이력 — staleness 판정·발행 이력 UI용
   * (architecture-v0.4.md §7.3). revision 내림차순.
   */
  async findRevisions(toolId: string): Promise<ToolRegistryEntry[]> {
    const entries = await this.toolModel
      .find({ tool_id: toolId })
      .sort({ revision: -1 })
      .exec();
    if (entries.length === 0) {
      throw new NotFoundException(`Tool not found: ${toolId}`);
    }
    return entries;
  }

  async findOne(toolId: string, revision?: number): Promise<ToolRegistryEntry> {
    const filter = revision
      ? { tool_id: toolId, revision }
      : { tool_id: toolId };
    const query = this.toolModel.findOne(filter);
    if (!revision) {
      query.sort({ revision: -1 });
    }
    const entry = await query.exec();
    if (!entry) {
      throw new NotFoundException(`Tool not found: ${toolId}`);
    }
    return entry;
  }

  /**
   * `version_label`(표시용 문자열, 예: 'federated-v1')로 조회한다. Agent Config 조립
   * (resolve) 전용 — 라벨은 identity가 아니라서 여러 revision이 같은 라벨을 들고 있을
   * 수 있고, 그럴 땐 최신 revision을 고른다. 못 찾아도 예외를 던지지 않고 null을
   * 돌려준다 — 호출자(AgentsService.resolveConfig)가 부분성공 응답을 만들기 위함이다.
   */
  async findByVersionLabel(
    toolId: string,
    versionLabel: string,
  ): Promise<ToolRegistryEntry | null> {
    return this.toolModel
      .findOne({ tool_id: toolId, version_label: versionLabel })
      .sort({ revision: -1 })
      .exec();
  }

  /**
   * Tool 발행 (architecture-v0.4.md §7.2).
   *
   * revision은 클라이언트가 지정하지 않고 서버가 tool_id별 최신값 +1로 계산한다.
   * 두 요청이 같은 revision을 동시에 계산하면 (tool_id, revision) 유니크 인덱스가
   * E11000으로 하나를 떨어뜨리므로, 그 경우 최신값을 다시 읽어 1회만 재시도한다
   * (docs/issues/0007-tool-registry-unique-index-blocks-revisions.md).
   */
  async publish(dto: PublishToolDto): Promise<ToolRegistryEntry> {
    // 구조 검증만 한다 — manifest의 내용이나 model.py의 훅 시그니처는 해석하지 않는다.
    if (
      !dto.manifest ||
      typeof dto.manifest !== 'object' ||
      Array.isArray(dto.manifest)
    ) {
      throw new BadRequestException('manifest must be a JSON object');
    }
    if (
      typeof dto.model_py_source !== 'string' ||
      dto.model_py_source.trim() === ''
    ) {
      throw new BadRequestException(
        'model_py_source must be a non-empty string',
      );
    }

    const fingerprint = computeManifestFingerprint(dto.manifest);

    try {
      return await this.createNextRevision(dto, fingerprint);
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      this.logger.warn(
        `publish() tool_id=${dto.tool_id} hit a duplicate (tool_id, revision) — concurrent publish detected, retrying once`,
      );
      return await this.createNextRevision(dto, fingerprint);
    }
  }

  /** 최신 revision을 다시 읽어 +1한 문서를 삽입한다. 충돌 시 E11000이 그대로 올라온다. */
  private async createNextRevision(
    dto: PublishToolDto,
    manifestFingerprint: string,
  ): Promise<ToolRegistryEntry> {
    const latest = await this.toolModel
      .findOne({ tool_id: dto.tool_id })
      .sort({ revision: -1 })
      .exec();
    const revision = (latest?.revision ?? 0) + 1;

    const created = await this.toolModel.create({
      tool_id: dto.tool_id,
      revision,
      source_task_id: dto.source_task_id,
      source_model_version: dto.source_model_version,
      manifest: dto.manifest,
      model_py_source: dto.model_py_source,
      source_model_py_source: dto.source_model_py_source ?? '',
      manifest_fingerprint: manifestFingerprint,
      wrapper_mode: dto.wrapper_mode,
      framework: dto.framework,
      description: dto.description ?? '',
      tags: dto.tags ?? [],
      version_label: dto.version_label ?? '',
      is_public: dto.is_public,
      publisher: UNKNOWN_PUBLISHER,
    });

    this.logger.log(
      `publish() tool_id=${dto.tool_id} revision=${revision} wrapper_mode=${dto.wrapper_mode} framework=${dto.framework} fingerprint=${manifestFingerprint.slice(0, 12)}`,
    );
    return created;
  }

  async updateVisibility(
    toolId: string,
    dto: UpdateToolVisibilityDto,
  ): Promise<ToolRegistryEntry> {
    const entry = await this.toolModel.findOneAndUpdate(
      { tool_id: toolId },
      { is_public: dto.is_public },
      { new: true },
    );
    if (!entry) {
      throw new NotFoundException(`Tool not found: ${toolId}`);
    }
    this.logger.log(
      `updateVisibility() tool_id=${toolId} is_public=${dto.is_public}`,
    );
    return entry;
  }

  async updateEnabled(
    toolId: string,
    dto: UpdateToolEnabledDto,
  ): Promise<ToolRegistryEntry> {
    const entry = await this.toolModel.findOneAndUpdate(
      { tool_id: toolId },
      { enabled: dto.enabled },
      { new: true },
    );
    if (!entry) {
      throw new NotFoundException(`Tool not found: ${toolId}`);
    }
    this.logger.log(`updateEnabled() tool_id=${toolId} enabled=${dto.enabled}`);
    return entry;
  }
}
