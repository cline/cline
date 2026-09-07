import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionService } from "../../session/services/file-session-service";
import { LocalRuntimeHost } from "./local-runtime-host";

function writeCursorTranscript(
	projectsDir: string,
	projectId: string,
	sessionId: string,
	content: string,
): void {
	const chatDir = join(
		projectsDir,
		projectId,
		"agent-transcripts",
		sessionId,
	);
	mkdirSync(chatDir, { recursive: true });
	writeFileSync(join(chatDir, `${sessionId}.jsonl`), content);
}

describe("LocalRuntimeHost session import", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CURSOR_PROJECTS_DIR: process.env.CURSOR_PROJECTS_DIR,
	};
	let isolatedHomeDir = "";
	let projectsDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-session-import-home-"));
		projectsDir = join(isolatedHomeDir, ".cursor", "projects");
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		process.env.CURSOR_PROJECTS_DIR = projectsDir;
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		if (envSnapshot.CURSOR_PROJECTS_DIR === undefined) {
			delete process.env.CURSOR_PROJECTS_DIR;
		} else {
			process.env.CURSOR_PROJECTS_DIR = envSnapshot.CURSOR_PROJECTS_DIR;
		}
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	it("lists importable Cursor sessions through the runtime host", async () => {
		writeCursorTranscript(
			projectsDir,
			"Users-ue-projects-demo",
			"session-1",
			`${JSON.stringify({
				cwd: "/Users/ue/projects/demo",
				role: "user",
				content: "hello from cursor",
			})}\n`,
		);

		const host = new LocalRuntimeHost({
			distinctId: "test-machine-id",
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
		});

		try {
			const discovered = await host.listImportableSessions({
				workspaceRoot: "/Users/ue/projects/demo",
			});
			expect(discovered).toHaveLength(1);
			expect(discovered[0].tool).toBe("cursor");
			expect(discovered[0].title).toBe("hello from cursor");
		} finally {
			await host.dispose();
		}
	});
});
