import { describe, it, expect } from 'vitest';
import { serialize, deserialize, serializeEnvelope, deserializeEnvelope } from '../../src/core/serializer';
import { SerializationError } from '../../src/core/errors';

describe('serialize()', () => {
  it('serializes primitives', () => {
    expect(serialize(42)).toBe('42');
    expect(serialize('hello')).toBe('"hello"');
    expect(serialize(true)).toBe('true');
    expect(serialize(null)).toBe('null');
  });

  it('serializes objects and arrays', () => {
    expect(serialize({ a: 1 })).toBe('{"a":1}');
    expect(serialize([1, 2, 3])).toBe('[1,2,3]');
  });

  it('serializes nested objects', () => {
    const obj = { user: { id: 1, tags: ['a', 'b'] } };
    const result = serialize(obj);
    expect(JSON.parse(result)).toEqual(obj);
  });

  it('throws SerializationError for circular references', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => serialize(a)).toThrow(SerializationError);
    expect(() => serialize(a)).toThrow('serialize');
  });

  it('throws SerializationError for undefined', () => {
    expect(() => serialize(undefined)).toThrow(SerializationError);
  });

  it('throws SerializationError for functions', () => {
    expect(() => serialize(() => {})).toThrow(SerializationError);
  });

  it('throws SerializationError for symbols', () => {
    expect(() => serialize(Symbol('x'))).toThrow(SerializationError);
  });

  it('handles BigInt gracefully via toJSON if present', () => {
    // BigInt without toJSON should throw (JSON.stringify limitation)
    expect(() => serialize(BigInt(9007199254740991))).toThrow(SerializationError);
  });
});

describe('deserialize()', () => {
  it('deserializes primitives', () => {
    expect(deserialize<number>('42')).toBe(42);
    expect(deserialize<string>('"hello"')).toBe('hello');
    expect(deserialize<boolean>('true')).toBe(true);
    expect(deserialize<null>('null')).toBeNull();
  });

  it('deserializes objects', () => {
    expect(deserialize<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('throws SerializationError for invalid JSON', () => {
    expect(() => deserialize('not-json')).toThrow(SerializationError);
    expect(() => deserialize('{unclosed')).toThrow(SerializationError);
  });

  it('blocks __proto__ pollution — Object.prototype is not mutated', () => {
    const malicious = '{"__proto__":{"polluted":true}}';
    deserialize<Record<string, unknown>>(malicious);
    // The critical check: Object.prototype must NOT have been mutated
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // Also verify the __proto__ key doesn't appear as an own property
    const result = deserialize<Record<string, unknown>>(malicious);
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
  });

  it('blocks constructor key pollution — Object.prototype is not mutated', () => {
    const malicious = '{"constructor":{"prototype":{"polluted":true}}}';
    deserialize<Record<string, unknown>>(malicious);
    // Verify prototype was not mutated
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // Verify constructor is not an own property (was stripped by reviver)
    const result = deserialize<Record<string, unknown>>(malicious);
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
  });

  it('blocks prototype key pollution', () => {
    const malicious = '{"prototype":{"polluted":true}}';
    const result = deserialize<Record<string, unknown>>(malicious);
    expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
  });
});

describe('serializeEnvelope() + deserializeEnvelope()', () => {
  it('round-trips a value with null expiry', () => {
    const raw = serializeEnvelope({ name: 'Alice' }, null);
    const envelope = deserializeEnvelope<{ name: string }>(raw);
    expect(envelope.v).toEqual({ name: 'Alice' });
    expect(envelope.exp).toBeNull();
  });

  it('round-trips a value with a future expiry timestamp', () => {
    const exp = Date.now() + 60_000;
    const raw = serializeEnvelope(42, exp);
    const envelope = deserializeEnvelope<number>(raw);
    expect(envelope.v).toBe(42);
    expect(envelope.exp).toBe(exp);
  });

  it('throws SerializationError for malformed envelope', () => {
    expect(() => deserializeEnvelope<unknown>('"not-an-envelope"')).toThrow(SerializationError);
  });

  it('throws SerializationError for envelope missing "v" field', () => {
    expect(() => deserializeEnvelope<unknown>('{"exp":null}')).toThrow(SerializationError);
  });

  it('throws SerializationError for envelope missing "exp" field', () => {
    expect(() => deserializeEnvelope<unknown>('{"v":1}')).toThrow(SerializationError);
  });
});
