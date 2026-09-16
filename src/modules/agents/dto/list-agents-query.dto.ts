import { RegistryListQueryDto } from '../../common/registry-list-query.dto';

/**
 * Agent 목록 조회 쿼리 (architecture-v0.4.md §7.1).
 * Agents는 리소스별 추가 필터가 없어 공통 파라미터만 그대로 쓴다 — 그래도
 * 별도 타입을 두어 나중에 필터가 생겨도 컨트롤러 시그니처가 바뀌지 않게 한다.
 */
export class ListAgentsQueryDto extends RegistryListQueryDto {}
