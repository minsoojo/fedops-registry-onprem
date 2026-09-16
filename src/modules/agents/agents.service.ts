import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  AgentRegistryEntry,
  AgentRegistryEntryDocument,
} from './schemas/agent-registry.schema';
import { PublishAgentDto } from './dto/publish-agent.dto';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto';
import { UpdateAgentVisibilityDto } from './dto/update-agent-visibility.dto';
import { UpdateAgentEnabledDto } from './dto/update-agent-enabled.dto';
import { ResolveAgentConfigDto } from './dto/resolve-agent-config.dto';
import {
  ResolveAgentConfigResult,
  ResolveError,
  ResolvedToolRef,
} from './dto/resolve-agent-config.types';
import {
  PaginatedResult,
  buildSearchOr,
  resolvePagination,
} from '../common/registry-list.util';
import { ToolsService } from '../tools/tools.service';
import { LlmsService } from '../llms/llms.service';

/** search 대상 필드 (architecture-v0.4.md §7.1 — Agent엔 tags가 없어 이름/설명) */
const AGENT_SEARCH_FIELDS = ['name', 'description'];

/**
 * Agent Config 발행/조회 서비스.
 *
 * Tool/LLM과 달리 Agent Config 발행은 순수 Mongo upsert다(오브젝트 스토리지도,
 * 코드 생성도 필요 없음 — architecture-v0.3.md §13.3) — 그래서 이 서비스는
 * 스캐폴딩이 아니라 온전히 구현했다.
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectModel(AgentRegistryEntry.name)
    private readonly agentModel: Model<AgentRegistryEntryDocument>,
    private readonly toolsService: ToolsService,
    private readonly llmsService: LlmsService,
  ) {}

  /**
   * Agent 목록 조회 — architecture-v0.4.md §7.1 공통 규칙(search/page/limit/publicOnly).
   * Agents는 리소스별 추가 필터가 없다.
   */
  async findAll(
    query: ListAgentsQueryDto = {},
  ): Promise<PaginatedResult<AgentRegistryEntry>> {
    const { page, limit, skip } = resolvePagination(query);
    const filter: FilterQuery<AgentRegistryEntryDocument> = {};

    // publicOnly는 'true'|'false' 문자열이다 (docs/issues/0008) — 'false'도 truthy이므로
    // 반드시 값 비교로 판정한다.
    if (query.publicOnly === 'true') {
      filter.is_public = true;
      filter.enabled = true;
    }
    const search = buildSearchOr(query.search, AGENT_SEARCH_FIELDS);
    if (search) {
      Object.assign(filter, search);
    }

    const [items, total] = await Promise.all([
      this.agentModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.agentModel.countDocuments(filter).exec(),
    ]);

    this.logger.debug(
      `findAll() returned ${items.length}/${total} agents (page=${page} limit=${limit})`,
    );
    return { items, total, page, limit };
  }

  async findOne(agentId: string): Promise<AgentRegistryEntry> {
    const entry = await this.agentModel.findOne({ agent_id: agentId }).exec();
    if (!entry) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    return entry;
  }

  /**
   * Agent Config의 `llm`/`tools` 참조(연구실 확정 형식, 2026-08-08 — camelCase +
   * 문자열 `modelVersion` 라벨)를 실제 Registry 엔트리로 조립한다.
   *
   * 부분성공을 허용한다 — 일부 참조가 없거나 `enabled:false`여도 전체를 실패시키지
   * 않는다. 찾은 항목은 전체 문서(manifest/model_py_source 포함, docs/data-structures.md
   * "Registry" 절의 "전체 문서 반환" 결정)를 그대로 채우고, 그렇지 못한 항목은 null +
   * `errors[]`에 사유를 남긴다.
   */
  async resolveConfig(
    dto: ResolveAgentConfigDto,
  ): Promise<ResolveAgentConfigResult> {
    const errors: ResolveError[] = [];

    const rawLlm = await this.llmsService.findByVersionLabel(
      dto.llm.modelId,
      dto.llm.modelVersion,
    );
    const llm = this.checkAvailable(
      rawLlm,
      'llm',
      dto.llm.modelId,
      dto.llm.modelVersion,
      errors,
    );

    const tools: ResolvedToolRef[] = await Promise.all(
      dto.tools.map(async (ref) => {
        const rawTool = await this.toolsService.findByVersionLabel(
          ref.toolId,
          ref.modelVersion,
        );
        const entry = this.checkAvailable(
          rawTool,
          'tool',
          ref.toolId,
          ref.modelVersion,
          errors,
        );
        return { toolId: ref.toolId, modelVersion: ref.modelVersion, entry };
      }),
    );

    this.logger.log(
      `resolveConfig() llm=${dto.llm.modelId}@${dto.llm.modelVersion} tools=${dto.tools.length} errors=${errors.length}`,
    );
    return { llm, tools, errors };
  }

  /** 못 찾았거나 비활성화된 엔트리는 null로 취급하고 errors에 사유를 남긴다. */
  private checkAvailable<T extends { enabled: boolean }>(
    entry: T | null,
    kind: ResolveError['kind'],
    id: string,
    modelVersion: string,
    errors: ResolveError[],
  ): T | null {
    if (!entry) {
      errors.push({ kind, id, modelVersion, reason: 'not_found' });
      return null;
    }
    if (!entry.enabled) {
      errors.push({ kind, id, modelVersion, reason: 'disabled' });
      return null;
    }
    return entry;
  }

  async publish(dto: PublishAgentDto): Promise<AgentRegistryEntry> {
    this.logger.log(
      `publish() agent_id=${dto.agent_id} build_revision=${dto.build_revision}`,
    );
    const entry = await this.agentModel.findOneAndUpdate(
      { agent_id: dto.agent_id },
      {
        agent_id: dto.agent_id,
        build_revision: dto.build_revision,
        name: dto.name,
        description: dto.description ?? '',
        config: dto.config,
        manifest_fingerprint: dto.manifest_fingerprint,
        is_public: dto.is_public,
        // publisher는 인증 모델 연동 전까지 임시로 'unknown' — architecture-v0.3.md §19
        publisher: 'unknown',
      },
      { upsert: true, new: true },
    );
    return entry;
  }

  async updateVisibility(
    agentId: string,
    dto: UpdateAgentVisibilityDto,
  ): Promise<AgentRegistryEntry> {
    const entry = await this.agentModel.findOneAndUpdate(
      { agent_id: agentId },
      { is_public: dto.is_public },
      { new: true },
    );
    if (!entry) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    this.logger.log(
      `updateVisibility() agent_id=${agentId} is_public=${dto.is_public}`,
    );
    return entry;
  }

  async updateEnabled(
    agentId: string,
    dto: UpdateAgentEnabledDto,
  ): Promise<AgentRegistryEntry> {
    const entry = await this.agentModel.findOneAndUpdate(
      { agent_id: agentId },
      { enabled: dto.enabled },
      { new: true },
    );
    if (!entry) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    this.logger.log(
      `updateEnabled() agent_id=${agentId} enabled=${dto.enabled}`,
    );
    return entry;
  }
}
