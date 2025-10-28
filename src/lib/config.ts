/**
 * Lightweight env var readers matching the API service pattern.
 * - If the env var is set (non-empty), parse and return it.
 * - Otherwise, if a default is provided, return the default.
 * - Otherwise, throw a helpful error.
 *
 * This version exposes four self-contained readers with an options object
 * supporting { default, min, max } where min/max apply to int/number only.
 */

export type BaseOptions<T> = { default?: T };
export type RangeOptions = BaseOptions<number> & { min?: number; max?: number };

function throwRequiredEnvVar(name: string): never {
  throw new Error(`${name} is required.`);
}

import { clamp } from "./number";

export function string(name: string, opts?: BaseOptions<string>): string {
  const value = process.env[name];
  const exists = value != null && value.length > 0;
  if (exists) {
    return value as string;
  }
  if (opts?.default !== undefined) {
    return opts.default;
  }
  return throwRequiredEnvVar(name);
}

export function boolean(name: string, opts?: BaseOptions<boolean>): boolean {
  const value = process.env[name];
  const exists = value != null && value.length > 0;
  if (exists) {
    const v = value as string;
    return ["0", "false"].includes(v) === false;
  }
  if (opts?.default !== undefined) {
    return opts.default;
  }
  return throwRequiredEnvVar(name);
}

export function int(name: string, opts?: RangeOptions): number {
  const value = process.env[name];
  const exists = value != null && value.length > 0;
  if (exists) {
    const parsed = Number.parseInt(value as string, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`${name} must be a valid integer`);
    }
    return clamp(parsed, opts?.min, opts?.max);
  }
  if (opts?.default !== undefined) {
    const def = Math.trunc(opts.default);
    return clamp(def, opts?.min, opts?.max);
  }
  return throwRequiredEnvVar(name);
}

export function number(name: string, opts?: RangeOptions): number {
  const value = process.env[name];
  const exists = value != null && value.length > 0;
  if (exists) {
    const parsed = Number.parseFloat(value as string);
    if (Number.isNaN(parsed)) {
      throw new Error(`${name} must be a valid number`);
    }
    return clamp(parsed, opts?.min, opts?.max);
  }
  if (opts?.default !== undefined) {
    return clamp(opts.default, opts?.min, opts?.max);
  }
  return throwRequiredEnvVar(name);
}
