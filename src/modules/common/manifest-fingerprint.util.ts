import { createHash } from 'crypto';

/**
 * manifest fingerprint 계산 헬퍼 (architecture-v0.4.md §7.2).
 *
 * Registry는 manifest를 파일이 아니라 JSON body로 받는다. 같은 내용이라도 호출자가
 * 직렬화한 키 순서는 요청마다 달라질 수 있으므로, 바이트를 그대로 해싱하면 동일한
 * manifest에 서로 다른 fingerprint가 붙는다. 그래서 해싱 전에 캐노니컬 형태
 * (객체 키를 사전순 정렬, 배열 순서는 의미가 있으므로 보존)로 다시 직렬화한다.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    // 함수/symbol 등 JSON에 표현할 수 없는 값은 null로 접는다.
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(',')}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value);
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`,
    );
  return `{${entries.join(',')}}`;
}

/** 캐노니컬 JSON 직렬화 후 sha256 (hex). */
export function computeManifestFingerprint(
  manifest: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(canonicalJsonStringify(manifest), 'utf8')
    .digest('hex');
}

/** MongoDB duplicate key error(E11000) 판별 — 동시 발행 레이스 감지용. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
