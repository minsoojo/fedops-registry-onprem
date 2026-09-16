import {
  canonicalJsonStringify,
  computeManifestFingerprint,
  isDuplicateKeyError,
} from './manifest-fingerprint.util';

describe('canonicalJsonStringify', () => {
  it('sorts object keys so key order does not change the output', () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJsonStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested object keys too', () => {
    expect(canonicalJsonStringify({ outer: { z: 1, a: { y: 1, x: 2 } } })).toBe(
      '{"outer":{"a":{"x":2,"y":1},"z":1}}',
    );
  });

  it('preserves array order (order is meaningful in arrays)', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('renders undefined as null and drops undefined object values', () => {
    expect(canonicalJsonStringify(undefined)).toBe('null');
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('computeManifestFingerprint', () => {
  it('produces a stable sha256 hex digest regardless of key order', () => {
    const a = computeManifestFingerprint({ id: 'x', inputs: [1, 2], v: 1 });
    const b = computeManifestFingerprint({ v: 1, inputs: [1, 2], id: 'x' });

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any value changes', () => {
    expect(computeManifestFingerprint({ id: 'x' })).not.toBe(
      computeManifestFingerprint({ id: 'y' }),
    );
  });
});

describe('isDuplicateKeyError', () => {
  it('detects MongoServerError code 11000', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDuplicateKeyError({ code: 121 })).toBe(false);
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });
});
