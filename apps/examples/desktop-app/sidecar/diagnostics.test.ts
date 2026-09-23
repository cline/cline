import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildDiagnosticsBundle,
	DIAGNOSTICS_HUB_LOG_TAIL_LINES,
	DIAGNOSTICS_LOG_TAIL_BYTES,
	redactDiagnosticsText,
	writeDiagnosticsBundle,
} from "./diagnostics";

let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

function readBundle(bundle: ReturnType<typeof buildDiagnosticsBundle>) {
	return Object.fromEntries(
		Object.entries(bundle.files).map(([name, bytes]) => [
			name,
			strFromU8(bytes),
		]),
	);
}

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
			"authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
			`workspaceRoot=${join(homedir(), "projects", "app")}`,
			"X-Api-Key=plain-key-value-123",
		].join("\n");
		const redacted = redactDiagnosticsText(text);
		expect(redacted).not.toContain("sk-ant-abcdefghijklmnop");
		expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
		expect(redacted).not.toContain("plain-key-value-123");
		expect(redacted).not.toContain(homedir());
		expect(redacted).toContain('"model":"claude"');
		expect(redacted).toContain(`workspaceRoot=${join("~", "projects", "app")}`);
	});
});

describe("buildDiagnosticsBundle", () => {
	it("bundles a report, log tails, and selected session manifests only", () => {
		writeFileSync(
			join(dataDir, "logs", "code.log"),
			'{"msg":"start","apiKey":"sk-live-1234567890"}\n{"msg":"ready"}\n', // gitleaks:allow
		);
		writeFileSync(
			join(dataDir, "logs", "hub-daemon.log"),
			'[hub] {"message":"command.start","command":"session.update"}\n',
		);
		writeSession("session_a", {
			session_id: "session_a",
			prompt: "fix the bug",
			metadata: { title: "Renamed", systemPrompt: "You are Cline…" },
		});
		writeSession("session_b", { session_id: "session_b", prompt: "other" });

		const bundle = buildDiagnosticsBundle({
			sessionIds: ["session_a", "../etc/passwd", "missing", "session_a"],
			hubUrl: "ws://127.0.0.1:1234/hub",
			runningSessionCount: 1,
			cloudAgents: { available: true, enabled: false },
			now: new Date(2026, 8, 22, 14, 5, 9),
		});
		const files = readBundle(bundle);

		expect(Object.keys(files).sort()).toEqual([
			"logs/code.log",
			"logs/hub-daemon.log",
			"report.json",
			"sessions/session_a.json",
		]);
		expect(bundle.fileName).toMatch(
			/^cline-diagnostics-.+-20260922-140509\.zip$/,
		);
		expect(bundle.sessionIds).toEqual(["session_a"]);

		const report = JSON.parse(files["report.json"]);
		expect(report.hubUrl).toBe("ws://127.0.0.1:1234/hub");
		expect(report.runningSessionCount).toBe(1);
		expect(report.cloudAgents).toEqual({ available: true, enabled: false });
		expect(report.includedSessions).toEqual(["session_a"]);
		expect(report.globalSettings).toBeTypeOf("object");

		const manifest = JSON.parse(files["sessions/session_a.json"]);
		expect(manifest.metadata.title).toBe("Renamed");
		expect(manifest.metadata.systemPrompt).toBeUndefined();
		expect(files["logs/code.log"]).not.toContain("sk-live-1234567890");
		expect(files["logs/code.log"]).toContain('"msg":"ready"');
		expect(JSON.stringify(files)).not.toContain("private conversation");
	});

	it("caps the log tails", () => {
		const line = `${"x".repeat(99)}\n`;
		writeFileSync(
			join(dataDir, "logs", "code.log"),
			line.repeat(Math.ceil(DIAGNOSTICS_LOG_TAIL_BYTES / line.length) + 50),
		);
		writeFileSync(
			join(dataDir, "logs", "hub-daemon.log"),
			Array.from(
				{ length: DIAGNOSTICS_HUB_LOG_TAIL_LINES + 250 },
				(_, index) => `line ${index}\n`,
			).join(""),
		);

		const files = readBundle(buildDiagnosticsBundle({ sessionIds: [] }));
		expect(files["logs/code.log"].length).toBeLessThanOrEqual(
			DIAGNOSTICS_LOG_TAIL_BYTES,
		);
		expect(files["logs/code.log"].startsWith("x")).toBe(true);
		const hubLines = files["logs/hub-daemon.log"].trimEnd().split("\n");
		expect(hubLines).toHaveLength(DIAGNOSTICS_HUB_LOG_TAIL_LINES);
		expect(hubLines[0]).toBe("line 250");
		expect(hubLines.at(-1)).toBe(
			`line ${DIAGNOSTICS_HUB_LOG_TAIL_LINES + 249}`,
		);
	});

	it("omits logs that do not exist instead of failing", () => {
		const files = readBundle(buildDiagnosticsBundle({ sessionIds: [] }));
		expect(Object.keys(files)).toEqual(["report.json"]);
	});
});

describe("writeDiagnosticsBundle", () => {
	it("writes a readable zip to the output directory", () => {
		writeFileSync(join(dataDir, "logs", "code.log"), "hello\n");
		const outputDir = join(dataDir, "out");
		const result = writeDiagnosticsBundle({ sessionIds: [] }, outputDir);

		expect(result.path.startsWith(outputDir)).toBe(true);
		expect(result.files).toEqual(["logs/code.log", "report.json"]);
		const unzipped = unzipSync(new Uint8Array(readFileSync(result.path)));
		expect(strFromU8(unzipped["logs/code.log"])).toBe("hello\n");
		expect(result.bytes).toBeGreaterThan(0);
	});
});
