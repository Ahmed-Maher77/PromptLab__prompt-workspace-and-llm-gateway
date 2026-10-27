import { validate } from 'class-validator';
import { IsStringRecord } from './is-string-record.validator';

class Sample {
  @IsStringRecord({ maxKeys: 3, maxValueLength: 5 })
  variables!: unknown;
}

async function errorsFor(variables: unknown) {
  const sample = new Sample();
  sample.variables = variables;
  return validate(sample);
}

describe('IsStringRecord', () => {
  it('accepts a valid map and an empty map', async () => {
    expect(await errorsFor({ name: 'Ada', 'my-var_1': 'hello' })).toHaveLength(0);
    expect(await errorsFor({})).toHaveLength(0);
  });

  it.each([
    ['null', null],
    ['an array', ['a']],
    ['a string', 'x'],
    ['a number', 4],
  ])('rejects %s', async (_label, value) => {
    expect(await errorsFor(value)).toHaveLength(1);
  });

  it('rejects number and object values', async () => {
    expect(await errorsFor({ a: 1 })).toHaveLength(1);
    expect(await errorsFor({ a: { b: 'c' } })).toHaveLength(1);
    expect(await errorsFor({ a: null })).toHaveLength(1);
  });

  it('rejects more keys than allowed', async () => {
    expect(await errorsFor({ a: '1', b: '2', c: '3' })).toHaveLength(0);
    expect(await errorsFor({ a: '1', b: '2', c: '3', d: '4' })).toHaveLength(1);
  });

  it('rejects bad key names', async () => {
    expect(await errorsFor({ 'has space': 'x' })).toHaveLength(1);
    expect(await errorsFor({ 'a.b': 'x' })).toHaveLength(1);
    expect(await errorsFor({ '': 'x' })).toHaveLength(1);
    expect(await errorsFor({ ['a'.repeat(65)]: 'x' })).toHaveLength(1);
  });

  it('rejects values over the length cap', async () => {
    expect(await errorsFor({ a: '12345' })).toHaveLength(0);
    expect(await errorsFor({ a: '123456' })).toHaveLength(1);
  });
});
