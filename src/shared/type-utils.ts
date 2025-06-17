/**
 * Type Safety Utilities for Cline
 * Implements advanced TypeScript patterns for bulletproof type safety
 */

// Branded types for preventing primitive obsession
export type Brand<T, B> = T & { __brand: B }

// Common branded types
export type TaskId = Brand<string, "TaskId">
export type ApiKey = Brand<string, "ApiKey">
export type ModelId = Brand<string, "ModelId">
export type UserId = Brand<string, "UserId">

// Result pattern for type-safe error handling
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E }

// Helper functions for Result pattern
export function success<T>(data: T): Result<T, never> {
	return { success: true, data }
}

export function failure<E>(error: E): Result<never, E> {
	return { success: false, error }
}

// Type guard for Result pattern
export function isSuccess<T, E>(result: Result<T, E>): result is { success: true; data: T } {
	return result.success
}

export function isFailure<T, E>(result: Result<T, E>): result is { success: false; error: E } {
	return !result.success
}

// Exhaustiveness checking
export function assertNever(x: never): never {
	throw new Error(`Unexpected value: ${x}`)
}

// Type-safe object keys
export function typedKeys<T extends Record<string, unknown>>(obj: T): Array<keyof T> {
	return Object.keys(obj) as Array<keyof T>
}

// Type-safe object entries
export function typedEntries<T extends Record<string, unknown>>(obj: T): Array<[keyof T, T[keyof T]]> {
	return Object.entries(obj) as Array<[keyof T, T[keyof T]]>
}

// Optional property type helper
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// Required property type helper
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>

// Deep readonly type
export type DeepReadonly<T> = {
	readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}

// Non-empty array type
export type NonEmptyArray<T> = [T, ...T[]]

// Type guard for non-empty arrays
export function isNonEmptyArray<T>(arr: T[]): arr is NonEmptyArray<T> {
	return arr.length > 0
}

// Validation error type
export class ValidationError extends Error {
	constructor(
		message: string,
		public field?: string,
	) {
		super(message)
		this.name = "ValidationError"
	}
}

// Type-safe JSON parsing
export function safeJsonParse<T>(json: string): Result<T, ValidationError> {
	try {
		const parsed = JSON.parse(json)
		return success(parsed as T)
	} catch (error) {
		return failure(new ValidationError(`Invalid JSON: ${error instanceof Error ? error.message : "Unknown error"}`))
	}
}

// Type predicate helpers
export function isDefined<T>(value: T | undefined | null): value is T {
	return value !== undefined && value !== null
}

export function isString(value: unknown): value is string {
	return typeof value === "string"
}

export function isNumber(value: unknown): value is number {
	return typeof value === "number" && !isNaN(value)
}

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Async Result helpers
export async function asyncResult<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>> {
	try {
		const data = await promise
		return success(data)
	} catch (error) {
		return failure(error as E)
	}
}

// Array utilities with type safety
export function head<T>(arr: NonEmptyArray<T>): T
export function head<T>(arr: T[]): T | undefined
export function head<T>(arr: T[]): T | undefined {
	return arr[0]
}

export function last<T>(arr: NonEmptyArray<T>): T
export function last<T>(arr: T[]): T | undefined
export function last<T>(arr: T[]): T | undefined {
	return arr[arr.length - 1]
}

// Type-safe environment variable access
export function getEnvVar(name: string): Result<string, ValidationError> {
	const value = process.env[name]
	if (value === undefined) {
		return failure(new ValidationError(`Environment variable ${name} is not defined`))
	}
	return success(value)
}

// Branded type creators
export function createTaskId(id: string): TaskId {
	return id as TaskId
}

export function createApiKey(key: string): ApiKey {
	return key as ApiKey
}

export function createModelId(id: string): ModelId {
	return id as ModelId
}

export function createUserId(id: string): UserId {
	return id as UserId
}
