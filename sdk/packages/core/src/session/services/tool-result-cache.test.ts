import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createToolResultCache,
	deleteToolResultCache,
	pruneToolResultCache,
	TOOL_RESULT_CACHE_TTL_MS,
} from "./tool-result-cache";

describe("temporary tool result cache", () => {
	let root: string;
	const caches: ReturnType<typeof createToolResultCache>[] = [];
	function cache(session = "session") {
		const value = createToolResultCache(session, { root });
		caches.push(value);
		return value;
	}
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "tool-result-cache-"));
	});
	afterEach(async () => {
		for (const value of caches.splice(0)) value.close();
		await rm(root, { recursive: true, force: true });
	});

	it("reuses a completed file without rewriting it and refreshes last use", async () => {
		const value = cache();
		const path = await value.save("call", "original\nresponse");
		const before = await stat(path);
		const old = new Date(Date.now() - TOOL_RESULT_CACHE_TTL_MS * 2);
		await utimes(path, old, old);
		expect(await value.save("call", "original\nresponse")).toBe(path);
		const after = await stat(path);
		expect(after.ino).toBe(before.ino);
		expect(after.mtimeMs).toBeGreaterThan(old.getTime());
		expect(await readFile(path, "utf8")).toBe("original\nresponse");
		expect(await readdir(dirname(path))).toEqual([path.split("/").at(-1)]);
		expect(after.mode & 0o777).toBe(0o600);
	});

	it("isolates sessions, repeated executions, and changed imported results", async () => {
		const first = cache("root@one+two");
		const second = cache("../other");
		const paths = await Promise.all([
			first.save("call", "first"),
			first.save("another-call", "first"),
			first.save("call", "changed"),
			second.save("call", "first"),
		]);
		expect(new Set(paths).size).toBe(4);
		for (const path of paths) expect(path.startsWith(`${root}/`)).toBe(true);
	});

	it("deduplicates concurrent saves and regenerates missing files", async () => {
		const value = cache();
		const paths = await Promise.all(
			Array.from({ length: 10 }, () => value.save("call", "full")),
		);
		expect(new Set(paths).size).toBe(1);
		await rm(paths[0]);
		expect(await cache().save("call", "full")).toBe(paths[0]);
		expect(await readFile(paths[0], "utf8")).toBe("full");
	});

	it("expires idle files after one day while retaining recently used files", async () => {
		const value = cache();
		const expired = await value.save("old", "old");
		const fresh = await value.save("new", "new");
		const old = new Date(Date.now() - TOOL_RESULT_CACHE_TTL_MS - 1000);
		await utimes(expired, old, old);
		value.close();
		await pruneToolResultCache(root);
		await expect(stat(expired)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(fresh, "utf8")).toBe("new");
	});

	it("protects live sessions until every runtime lease has closed", async () => {
		const first = cache();
		const second = cache();
		const path = await first.save("call", "full");
		const old = new Date(Date.now() - TOOL_RESULT_CACHE_TTL_MS * 2);
		await utimes(path, old, old);
		first.close();
		first.close();
		await pruneToolResultCache(root);
		expect(await readFile(path, "utf8")).toBe("full");
		second.close();
		await pruneToolResultCache(root);
		await expect(stat(dirname(path))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("deletes only the requested session cache", async () => {
		const first = await cache("first").save("call", "first");
		const second = await cache("second").save("call", "second");
		await deleteToolResultCache("first", root);
		await expect(stat(first)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(second, "utf8")).toBe("second");
	});

	it("allows retry after a failed write without retaining a rejected promise", async () => {
		const blocked = join(root, "blocked");
		await writeFile(blocked, "blocked");
		const value = createToolResultCache("session", { root: blocked });
		caches.push(value);
		await expect(value.save("call", "full")).rejects.toThrow();
		await rm(blocked);
		expect(await readFile(await value.save("call", "full"), "utf8")).toBe(
			"full",
		);
	});
});
