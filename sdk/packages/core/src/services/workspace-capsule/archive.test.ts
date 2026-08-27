import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
	WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH,
	WORKSPACE_CAPSULE_MAX_MANIFEST_BYTES,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	createWorkspaceCapsuleArchiveStream,
	writeWorkspaceCapsuleArchive,
} from "./archive";
import { buildWorkspaceCapsulePlan } from "./builder";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "cline-capsule-archive-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function readString(buffer: Buffer, offset: number, length: number): string {
	const bytes = buffer.subarray(offset, offset + length);
	const zero = bytes.indexOf(0);
	return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString("utf8");
}

function parseTar(archive: Buffer): Map<string, Buffer> {
	const members = new Map<string, Buffer>();
	let offset = 0;
	while (offset + 512 <= archive.byteLength) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = readString(header, 0, 100);
		const prefix = readString(header, 345, 155);
		const path = prefix ? `${prefix}/${name}` : name;
		const sizeText = readString(header, 124, 12).trim();
		const size = Number.parseInt(sizeText || "0", 8);
		offset += 512;
		members.set(path, archive.subarray(offset, offset + size));
		offset += Math.ceil(size / 512) * 512;
	}
	return members;
}

describe("createWorkspaceCapsuleArchiveStream", () => {
	it("matches the committed cross-runtime v1 golden fixture", async () => {
		const fixture = JSON.parse(
			await readFile(
				new URL("./fixtures/v1-golden.json", import.meta.url),
				"utf8",
			),
		) as {
			manifest: unknown;
			files: Record<string, string>;
			archiveBase64: string;
			metadata: Record<string, unknown>;
		};
		const root = await temporaryDirectory();
		await writeFile(
			join(root, "hello.txt"),
			Buffer.from(fixture.files["hello.txt"], "base64"),
		);
		await chmod(join(root, "hello.txt"), 0o644);
		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "hello.txt" }],
			team: {
				teamId: "t_golden",
				agentId: "cloud-reviewer",
				taskId: "task_1",
				runId: "run_00001",
			},
			now: () => new Date("2026-08-26T12:00:00.000Z"),
		});
		expect(plan.manifest).toEqual(fixture.manifest);

		const outputPath = join(root, "golden.tar.gz");
		const metadata = await writeWorkspaceCapsuleArchive(plan, outputPath);
		const archive = await readFile(outputPath);
		expect(archive.toString("base64")).toBe(fixture.archiveBase64);
		expect(metadata).toEqual(fixture.metadata);
	});

	it("writes a deterministic archive with manifest and exact entry paths", async () => {
		const root = await temporaryDirectory();
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "index.ts"), "export const ok = true;\n");
		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "src" }],
			now: () => new Date("2026-08-26T12:00:00.000Z"),
		});

		const first = await collect(createWorkspaceCapsuleArchiveStream(plan));
		const second = await collect(createWorkspaceCapsuleArchiveStream(plan));
		expect(first).toEqual(second);

		const members = parseTar(gunzipSync(first));
		expect(Array.from(members.keys())).toEqual([
			WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH,
			...plan.manifest.entries.map((entry) => entry.path),
		]);
		expect(
			JSON.parse(
				members
					.get(WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH)
					?.toString("utf8") ?? "null",
			),
		).toEqual(plan.manifest);
		expect(members.get("src/index.ts")?.toString("utf8")).toBe(
			"export const ok = true;\n",
		);
	});

	it("fails closed when a payload changes after planning", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "input.txt"), "before");
		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "input.txt" }],
		});
		await writeFile(join(root, "input.txt"), "after!");

		await expect(
			collect(createWorkspaceCapsuleArchiveStream(plan)),
		).rejects.toMatchObject({ code: "FILE_CHANGED" });
	});

	it("enforces the compressed archive byte limit while streaming", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "input.txt"), "content");
		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "input.txt" }],
			limits: { maxArchiveBytes: 1 },
		});

		await expect(
			collect(createWorkspaceCapsuleArchiveStream(plan)),
		).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
	});

	it("rejects an oversized exact manifest before creating an output file", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "input.txt"), "content");
		const plan = await buildWorkspaceCapsulePlan({
			roots: [{ id: "workspace", path: root }],
			selections: [{ rootId: "workspace", path: "input.txt" }],
		});
		plan.manifest.git = {
			branch: "x".repeat(WORKSPACE_CAPSULE_MAX_MANIFEST_BYTES),
		};

		expect(() => createWorkspaceCapsuleArchiveStream(plan)).toThrow(
			expect.objectContaining({ code: "MANIFEST_TOO_LARGE" }),
		);
		const outputPath = join(root, "oversized.tar.gz");
		await expect(
			writeWorkspaceCapsuleArchive(plan, outputPath),
		).rejects.toMatchObject({ code: "MANIFEST_TOO_LARGE" });
		await expect(access(outputPath)).rejects.toBeDefined();
	});
});
