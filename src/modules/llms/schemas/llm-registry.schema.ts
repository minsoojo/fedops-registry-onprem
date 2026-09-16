import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LlmRegistryEntryDocument = LlmRegistryEntry & Document;
export type LlmSourceKind = 'registry' | 'huggingface';

/**
 * LLM 소스 참조 — discriminated union (architecture-v0.3.md §13.2).
 * source==='registry'면 s3_key(fedops-llms 버킷)를, source==='huggingface'면
 * repo_id/filename/revision을 사용한다. 실제 바이너리 호스팅과 외부 참조를 동시에 지원.
 */
@Schema({ _id: false })
export class LlmSourceRef {
  @Prop({ required: true, enum: ['registry', 'huggingface'] })
  source: LlmSourceKind;

  @Prop()
  s3_key?: string; // source === 'registry'

  @Prop()
  repo_id?: string; // source === 'huggingface'

  @Prop()
  filename?: string; // source === 'huggingface'

  @Prop()
  revision?: string; // source === 'huggingface'
}

export const LlmSourceRefSchema = SchemaFactory.createForClass(LlmSourceRef);

/**
 * 등록된 LLM 도메인 엔티티. MongoDB 컬렉션: llm-registry
 */
@Schema({ collection: 'llm-registry', timestamps: true })
export class LlmRegistryEntry {
  @Prop({ required: true, unique: true })
  llm_id: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  display_name: string;

  @Prop({ type: LlmSourceRefSchema, required: true })
  ref: LlmSourceRef;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: false })
  is_public: boolean;

  @Prop({ default: true })
  enabled: boolean;

  // 표시용 버전 라벨(예: 'q4-k-m' 양자화 표기) — llm_id 유니크·"최신" 판정은 여전히
  // version(정수)이 담당한다. 라벨은 자유 문자열이라 identity를 대체하지 않고 조회
  // 필터로만 쓰는 보조 필드다(연구실 AgentConfig 형식 결정, docs/data-structures.md
  // "Registry" 절 참고).
  @Prop({ default: '' })
  version_label: string;

  // Follow-up (architecture-v0.3.md §13.2 / 세션 계획 §7): huggingface 소스 엔트리용
  // identity(sha256(provider|repo_id|filename|revision)) 중복확인 필드는 이번 스키마엔 미포함.
}

export const LlmRegistryEntrySchema =
  SchemaFactory.createForClass(LlmRegistryEntry);
