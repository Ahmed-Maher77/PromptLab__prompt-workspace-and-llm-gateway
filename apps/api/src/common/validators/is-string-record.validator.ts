import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';

export interface StringRecordOptions {
  maxKeys?: number;
  maxValueLength?: number;
}

const KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Returns a human-readable reason when the value is not an acceptable string map,
 * or null when it is valid.
 */
export function describeStringRecordProblem(
  value: unknown,
  { maxKeys = 50, maxValueLength = 32768 }: StringRecordOptions = {},
): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'must be an object of string values';
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxKeys) {
    return `must not contain more than ${maxKeys} keys`;
  }
  for (const [key, val] of entries) {
    if (!KEY_PATTERN.test(key)) {
      return `has an invalid key "${key.slice(0, 32)}" (use 1-64 letters, digits, "_" or "-")`;
    }
    if (typeof val !== 'string') {
      return `value for "${key}" must be a string`;
    }
    if (val.length > maxValueLength) {
      return `value for "${key}" must not exceed ${maxValueLength} characters`;
    }
  }
  return null;
}

/** Validates a plain object whose keys are variable names and whose values are bounded strings. */
export function IsStringRecord(options: StringRecordOptions = {}, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStringRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return describeStringRecordProblem(value, options) === null;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} ${describeStringRecordProblem(args.value, options) ?? 'is invalid'}`;
        },
      },
    });
  };
}
