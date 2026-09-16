import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ToolRegistryEntryDocument = ToolRegistryEntry & Document;

export type ToolWrapperMode = 'auto' | 'manual';
export type ToolFramework = 'pytorch' | 'tensorflow' | 'huggingface';

/**
 * 발행된 Tool(= public 공개된 Task의 글로벌 모델 + 서빙 래퍼) 도메인 엔티티
 * MongoDB 컬렉션: tool-registry
 *
 * manifest/model_py_source는 오브젝트 스토리지가 아니라 문서에 직접 embed한다
 * (architecture-v0.3.md §13.1 — Tool 번들은 KB급 텍스트/코드라 MinIO 왕복이 불필요).
 * 실제 모델 가중치는 source_task_id/source_model_version 참조로만 남기고 복사하지 않는다.
 */
@Schema({ collection: 'tool-registry', timestamps: true })
export class ToolRegistryEntry {
  // 단일 유니크가 아니다 — 같은 tool_id에 revision이 여러 개 쌓이는 것이 설계 의도다.
  // 고유 제약은 아래 (tool_id, revision) 복합 유니크 인덱스가 담당한다
  // (docs/issues/0007-tool-registry-unique-index-blocks-revisions.md).
  @Prop({ required: true })
  tool_id: string; // kebab-case, manifest.id와 일치

  @Prop({ required: true })
  revision: number; // manifest.revision, tool_id별 단조증가

  @Prop({ required: true, index: true })
  source_task_id: string; // tasks.task_id — 문자열 링크(ref 아님, 기존 컨벤션)

  @Prop({ required: true })
  source_model_version: number; // gl_model_v

  @Prop({ type: Object, required: true })
  manifest: Record<string, unknown>; // tool-manifest.json 전체 (opaque embed)

  @Prop({ required: true })
  model_py_source: string; // model.py 소스 코드 텍스트 (auto 경로면 generic-tensor-model.py 내용)

  @Prop({ default: '' })
  source_model_py_source: string; // auto 경로 전용: 원본 task/model.py 소스(get_model() 포함). manual 경로면 빈 문자열

  @Prop({ required: true })
  manifest_fingerprint: string; // sha256(tool-manifest.json bytes)

  @Prop({ required: true, enum: ['auto', 'manual'] })
  wrapper_mode: ToolWrapperMode;

  @Prop({ required: true, enum: ['pytorch', 'tensorflow', 'huggingface'] })
  framework: ToolFramework;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ required: true })
  publisher: string; // 인증 모델 미연동 — 현재는 자유 텍스트 (architecture-v0.3.md §19)

  @Prop({ default: false })
  is_public: boolean;

  @Prop({ default: true })
  enabled: boolean;

  // 표시용 버전 라벨(예: 'federated-v1') — (tool_id, revision) 유니크·정렬은 여전히
  // revision(정수)이 담당한다. 라벨은 자유 문자열이라 "최신" 판정에 못 쓴다 — 그래서
  // identity를 대체하지 않고 조회 필터로만 쓰는 보조 필드로 추가한다(연구실 AgentConfig
  // 형식 결정, docs/data-structures.md "Registry" 절 참고).
  @Prop({ default: '' })
  version_label: string;
}

export const ToolRegistryEntrySchema =
  SchemaFactory.createForClass(ToolRegistryEntry);

// (tool_id, revision) 복합 유니크 — 같은 tool_id에 같은 revision이 두 번 저장되는 것만
// 막는다. 오름차순 정의여도 Mongo 인덱스는 양방향 스캔이 가능해 최신 revision 조회
// (`.sort({ revision: -1 })`)에도 그대로 쓰인다.
// ToolsService.publish()의 동시 발행 레이스는 이 인덱스의 E11000을 신호로 재시도한다.
ToolRegistryEntrySchema.index({ tool_id: 1, revision: 1 }, { unique: true });
