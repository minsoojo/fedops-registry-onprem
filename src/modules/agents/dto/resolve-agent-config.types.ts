import { LlmRegistryEntry } from '../../llms/schemas/llm-registry.schema';
import { ToolRegistryEntry } from '../../tools/schemas/tool-registry.schema';

/** 못 찾았거나 비활성화된 참조 하나를 설명한다. */
export interface ResolveError {
  kind: 'llm' | 'tool';
  /** llm은 modelId, tool은 toolId */
  id: string;
  modelVersion: string;
  reason: 'not_found' | 'disabled';
}

export interface ResolvedToolRef {
  toolId: string;
  modelVersion: string;
  /** 못 찾았거나 비활성화됐으면 null — 사유는 errors[]에서 확인 */
  entry: ToolRegistryEntry | null;
}

/**
 * `POST /v1/registry/agents/resolve` 응답 — 부분성공을 허용한다(2026-08-08 결정).
 * 일부 참조가 없거나 비활성화돼 있어도 전체를 실패시키지 않고, 찾은 것은 채우고
 * 못 찾은 것만 errors[]에 남긴다.
 */
export interface ResolveAgentConfigResult {
  llm: LlmRegistryEntry | null;
  tools: ResolvedToolRef[];
  errors: ResolveError[];
}
