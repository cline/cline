/**
 * Minimal local declaration for `bun:sqlite` (the CLI embeds Bun, so this
 * module exists at runtime). Declaring only what support.ts uses avoids an
 * npm dependency on `bun-types`.
 */
declare module "bun:sqlite" {
	export class Database {
		constructor(path: string, options?: { create?: boolean; readonly?: boolean });
		exec(sql: string): void;
		query(sql: string): {
			all(...params: unknown[]): unknown[];
			run(...params: unknown[]): void;
		};
		close(): void;
	}
}
