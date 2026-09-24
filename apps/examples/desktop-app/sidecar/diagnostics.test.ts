import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildDiagnosticsReport,
	DIAGNOSTICS_LOG_TAIL_BYTES,
	redactDiagnosticsText,
	writeDiagnosticsReport,
} from "./diagnostics";

let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-diagnostics-"));
	for (const key of [
		"CLINE_DATA_DIR",
		"CLINE_SESSION_DATA_DIR",
		"CLINE_LOG_PATH",
	]) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_SESSION_DATA_DIR = join(dataDir, "sessions");
	mkdirSync(join(dataDir, "logs"), { recursive: true });
});

afterEach(() => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(dataDir, { recursive: true, force: true });
});

function writeSession(sessionId: string, manifest: Record<string, unknown>) {
	const dir = join(dataDir, "sessions", sessionId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(manifest));
	writeFileSync(
		join(dir, `${sessionId}.messages.json`),
		JSON.stringify([{ role: "user", content: "private conversation" }]),
	);
}

describe("redactDiagnosticsText", () => {
	it("blanks credential-looking values and the home directory", () => {
		const text = [
			'{"apiKey":"sk-ant-abcdefghijklmnop","model":"claude"}', // gitleaks:allow
			"access_token=plain-token-value-123",
			`workspaceRoot=${join(homedir(), "projects", "app")}`,
		].join("\n");
		const redacted = redactDiagnosticsText(text);
		expect(redacted).not.toContain("sk-ant-abcdefghijklmnop");
		expect(redacted).not.toContain("plain-token-value-123");
		expect(redacted).not.toContain(homedir());
		expect(redacted).toContain('"model":"claude"');
		expect(redacted).toContain(`workspaceRoot=${join("~", "projects", "app")}`);
	});
});

describe("buildDiagnosticsReport", () => {
	it("includes app info, log tails, and the selected session manifests", () => {
		writeFileSync(
			join(dataDir, "logs", "code.log"),
			'{"msg":"start","apiKey":"sk-live-1234567890"}\n{"msg":"ready"}\n', // gitleaks:allow
		);
		writeFileSync(join(dataDir, "logs", "hub-daemon.log"), "[hub] ok\n");
		writeSession("session_a", {
			session_id: "session_a",
			prompt: "fix the bug in my secret project",
			metadata: {
				title: "Renamed",
				prompt: "fix the bug in my secret project",
				systemPrompt: "You are Cline…",
			},
		});
		writeSession("session_b", { session_id: "session_b", prompt: "other" });

		const report = buildDiagnosticsReport([
			"session_a",
			"../etc/passwd",
			"missing",
			"session_a",
		]);

		expect(report.sessionIds).toEqual(["session_a"]);
		expect(report.text).toContain('"version"');
		expect(report.text).toContain("===== tail of ");
		expect(report.text).toContain('"msg":"ready"');
		expect(report.text).toContain("[hub] ok");
		expect(report.text).toContain("===== session session_a =====");
		expect(report.text).toContain('"title": "Renamed"');
		expect(report.text).not.toContain("session_b");
		expect(report.text).not.toContain("sk-live-1234567890");
		expect(report.text).not.toContain("systemPrompt");
		expect(report.text).not.toContain("secret project");
		expect(report.text).not.toContain("private conversation");
	});

	it("caps each log tail and omits logs that do not exist", () => {
		const line = `${"x".repeat(99)}\n`;
		writeFileSync(
			join(dataDir, "logs", "code.log"),
			line.repeat(Math.ceil(DIAGNOSTICS_LOG_TAIL_BYTES / line.length) + 50),
		);

		const { text } = buildDiagnosticsReport([]);
		const logLines = text.split("\n").filter((entry) => entry.startsWith("x"));
		expect(logLines.length).toBe(
			Math.floor(DIAGNOSTICS_LOG_TAIL_BYTES / line.length),
		);
		expect(text).toContain("=====\nxxx");
		expect(text).not.toContain("hub-daemon.log");
	});
});

describe("writeDiagnosticsReport", () => {
	it("writes the report to the output directory", () => {
		writeFileSync(join(dataDir, "logs", "code.log"), "hello\n");
		const outputDir = join(dataDir, "out");
		const result = writeDiagnosticsReport([], outputDir);

		expect(result.path).toMatch(/[\\/]cline-diagnostics-.+\.txt$/);
		expect(result.path.startsWith(outputDir)).toBe(true);
		expect(readFileSync(result.path, "utf8")).toContain("hello");
	});
});
