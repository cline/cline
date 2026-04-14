import { describe, expect, it } from "vitest";
import { isSqliteBusyError, withSqliteBusyRetry } from "./sqlite-db";

describe("isSqliteBusyError", () => {
	it("detects busy and locked sqlite errors by code", () => {
		expect(isSqliteBusyError({ code: "SQLITE_BUSY" })).toBe(true);
		expect(isSqliteBusyError({ code: "SQLITE_LOCKED" })).toBe(true);
	});

	it("detects busy and locked sqlite errors by message", () => {
		expect(
			isSqliteBusyError(new Error("SQLITE_BUSY: database is locked")),
		).toBe(true);
		expect(isSqliteBusyError(new Error("database is locked"))).toBe(true);
	});

	it("does not match unrelated errors", () => {
		expect(isSqliteBusyError(new Error("something else"))).toBe(false);
		expect(isSqliteBusyError(undefined)).toBe(false);
	});
});

describe("withSqliteBusyRetry", () => {
	it("retries transient sqlite busy failures and returns the eventual value", () => {
		let attempts = 0;

		const result = withSqliteBusyRetry(() => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error("SQLITE_BUSY: database is locked");
			}
			return "ok";
		});

		expect(result).toBe("ok");
		expect(attempts).toBe(3);
	});

	it("rethrows non-sqlite errors immediately", () => {
		expect(() =>
			withSqliteBusyRetry(() => {
				throw new Error("boom");
			}),
		).toThrow("boom");
	});

	it("stops retrying after the retry budget is exhausted", () => {
		let attempts = 0;

		expect(() =>
			withSqliteBusyRetry(() => {
				attempts += 1;
				throw new Error("SQLITE_BUSY: database is locked");
			}),
		).toThrow("SQLITE_BUSY");
		expect(attempts).toBe(4);
	});
});
