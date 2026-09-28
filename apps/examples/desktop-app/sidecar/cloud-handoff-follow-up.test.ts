import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	clearCloudHandoffFollowUp,
	readCloudHandoffFollowUp,
	saveCloudHandoffFollowUp,
} from "./cloud-handoff-follow-up";

let dataDir: string;
beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-handoff-follow-up-"));
	vi.stubEnv("CLINE_DATA_DIR", dataDir);
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dataDir, { recursive: true, force: true });
});

it("persists the command and image bytes independently of process state until acknowledged", () => {
	const saved = {
		sourceSessionId: "local-source",
		command: "inspect this",
		userImages: ["data:image/png;base64,aW1hZ2U="],
	};
	saveCloudHandoffFollowUp("cloud-target", saved);
	const directory = join(dataDir, "desktop-handoff-follow-ups");
	const files = readdirSync(directory);
	expect(files).toHaveLength(1);
	expect(JSON.parse(readFileSync(join(directory, files[0]), "utf8"))).toEqual(
		saved,
	);
	if (process.platform !== "win32")
		expect(statSync(join(directory, files[0])).mode & 0o777).toBe(0o600);
	expect(readCloudHandoffFollowUp("cloud-target")).toEqual(saved);
	expect(readCloudHandoffFollowUp("another-target")).toBeNull();
	clearCloudHandoffFollowUp("cloud-target");
	clearCloudHandoffFollowUp("cloud-target");
	expect(readCloudHandoffFollowUp("cloud-target")).toBeNull();
});

it("keeps untrusted session ids inside the recovery directory", () => {
	saveCloudHandoffFollowUp("../../outside", {
		sourceSessionId: "source",
		command: "hello",
		userImages: [],
	});
	expect(readdirSync(dataDir)).toEqual(["desktop-handoff-follow-ups"]);
	expect(readCloudHandoffFollowUp("../../outside")?.command).toBe("hello");
});
