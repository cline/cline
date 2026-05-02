import type { SessionBackend } from "./session-record";

type AnyMethod = (...args: unknown[]) => unknown;

function getMethod(backend: SessionBackend, method: string): AnyMethod | null {
	const callable = (backend as unknown as Record<string, unknown>)[method];
	return typeof callable === "function" ? (callable as AnyMethod) : null;
}

export async function invokeBackend<T>(
	backend: SessionBackend,
	method: string,
	...args: unknown[]
): Promise<T> {
	const callable = getMethod(backend, method);
	if (!callable) {
		throw new Error(`session service method not available: ${method}`);
	}
	return Promise.resolve(callable.apply(backend, args)) as Promise<T>;
}

export async function invokeBackendOptional(
	backend: SessionBackend,
	method: string,
	...args: unknown[]
): Promise<void> {
	const callable = getMethod(backend, method);
	if (!callable) return;
	await Promise.resolve(callable.apply(backend, args));
}

export async function invokeBackendOptionalValue<T = unknown>(
	backend: SessionBackend,
	method: string,
	...args: unknown[]
): Promise<T | undefined> {
	const callable = getMethod(backend, method);
	if (!callable) return undefined;
	return (await Promise.resolve(callable.apply(backend, args))) as T;
}
