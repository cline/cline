import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	type CloudCreationRecord,
	CloudCreationStore,
	CREATION_RETENTION_MS,
	cloudScopeKey,
} from "./storage";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
it("stores only whitelisted private atomic records, scoped to account/org/environment", () => {
	const root = mkdtempSync(join(tmpdir(), "cloud-storage-"));
	roots.push(root);
	const store = new CloudCreationStore(root, () => 100);
	const row: CloudCreationRecord = {
		version: 1,
		requestId: "request",
		scope: {
			apiBaseUrl: "https://api.example.test",
			accountId: "a",
			organizationId: "org",
		},
		createdAt: 100,
		updatedAt: 100,
		intent: "detached",
		initialTaskPending: true,
		prompt: "private prompt",
		repoUrl: "https://github.com/a/b",
		modelId: "m",
		autoApproveTools: false,
	};
	store.save({ ...row, accessToken: "secret" } as CloudCreationRecord);
	const directory = join(root, cloudScopeKey(row.scope));
	const path = join(directory, "request.json");
	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(statSync(directory).mode & 0o777).toBe(0o700);
	expect(readFileSync(path, "utf8")).not.toContain("secret");
	expect(readdirSync(directory)).toEqual(["request.json"]);
	expect(store.list(row.scope)).toEqual([row]);
	expect(store.list({ ...row.scope, organizationId: undefined })).toEqual([]);
	expect(store.list({ ...row.scope, accountId: "b" })).toEqual([]);
	expect(
		store.list({ ...row.scope, apiBaseUrl: "https://other.test" }),
	).toEqual([]);
	const expired = new CloudCreationStore(
		root,
		() => 100 + CREATION_RETENTION_MS + 1,
	);
	expect(expired.list(row.scope)).toEqual([]);
});
