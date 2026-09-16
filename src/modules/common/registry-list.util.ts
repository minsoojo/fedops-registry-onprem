/**
 * Registry 세 리소스(tools/llms/agents)의 목록 조회 공통 헬퍼.
 *
 * architecture-v0.4.md §7.1 — 세 리소스의 `GET /`은 쿼리 파라미터 이름과 응답
 * 봉투를 통일한다. Console이 검색 UI/훅을 리소스 이름만 바꿔 재사용할 수 있게
 * 하기 위한 결정이라, 페이지네이션 기본값·검색 정규식 생성 로직을 여기에 모아
 * 세 서비스가 같은 구현을 공유하게 한다.
 */

/** §7.1 공통 응답 봉투 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;

export interface PaginationInput {
  page?: number;
  limit?: number;
}

export interface ResolvedPagination {
  page: number;
  limit: number;
  skip: number;
}

/**
 * page/limit을 기본값·하한과 함께 정규화한다. DTO 검증(@Min)이 이미 한 번 걸러주지만,
 * 서비스가 컨트롤러 없이 직접 호출되는 경우(테스트·내부 재사용)에도 안전하도록
 * 여기서 한 번 더 방어한다.
 */
export function resolvePagination(query: PaginationInput): ResolvedPagination {
  const page =
    typeof query.page === 'number' && query.page >= 1
      ? Math.floor(query.page)
      : DEFAULT_PAGE;
  const limit =
    typeof query.limit === 'number' && query.limit >= 1
      ? Math.floor(query.limit)
      : DEFAULT_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `search` 쿼리를 지정한 필드들에 대한 대소문자 무시 부분일치 $or 절로 변환한다.
 * 사용자가 넘긴 문자열은 그대로 정규식이 되면 안 되므로 메타문자를 이스케이프한다.
 * 배열 필드(tags)는 Mongo가 원소 단위로 매칭해주므로 같은 절을 그대로 쓸 수 있다.
 *
 * @returns 검색어가 없으면 undefined (필터를 얹지 않음)
 */
export function buildSearchOr(
  search: string | undefined,
  fields: string[],
): { $or: Record<string, RegExp>[] } | undefined {
  const term = search?.trim();
  if (!term) {
    return undefined;
  }
  const pattern = new RegExp(escapeRegExp(term), 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}
