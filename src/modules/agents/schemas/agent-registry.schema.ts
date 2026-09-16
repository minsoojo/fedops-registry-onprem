import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentRegistryEntryDocument = AgentRegistryEntry & Document;

/**
 * 발행된 Agent Config 도메인 엔티티. MongoDB 컬렉션: agent-registry
 *
 * config는 AgentConfig(FedOps2-Client schemas/agent.py) JSON 전체를 그대로 embed한다 —
 * Agent Config는 KB급 JSON이라 Tool과 동일한 이유로 오브젝트 스토리지가 불필요하다
 * (architecture-v0.3.md §13.3).
 */
@Schema({ collection: 'agent-registry', timestamps: true })
export class AgentRegistryEntry {
  @Prop({ required: true, unique: true })
  agent_id: string; // uuid, AgentConfig.id와 일치

  @Prop({ required: true })
  build_revision: number;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: Object, required: true })
  config: Record<string, unknown>; // AgentConfig JSON 전체 (opaque embed)

  // NOTE: 용어 개명(Agent Manifest → Agent Config) 범위는 config 필드까지로 한정했다.
  // manifest_fingerprint는 = sha256(config bytes)이지만 이름은 그대로 둔다 — 발행자
  // (FedOps2-Client)와의 필드명 계약이라 양쪽 동시 변경이 필요하다.
  @Prop({ required: true })
  manifest_fingerprint: string;

  @Prop({ required: true })
  publisher: string;

  @Prop({ default: false })
  is_public: boolean;

  @Prop({ default: true })
  enabled: boolean;
}

export const AgentRegistryEntrySchema =
  SchemaFactory.createForClass(AgentRegistryEntry);
