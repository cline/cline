import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPersistedMessagesFile } from "./runtime-host-support";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("readPersistedMessagesFile", () => {
	it("strips wrapped user_input envelopes from user history messages", async () => {
		const dir = await mkdtemp(join(tmpdir(), "runtime-host-support-"));
		tempDirs.push(dir);
		const messagesPath = join(dir, "messages.json");
		await writeFile(
			messagesPath,
			JSON.stringify([
				{
					role: "user",
					content: '<user_input mode="act">spawn a team of agents</user_input>',
				},
				{
					role: "assistant",
					content: "Working on it.",
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: '<user_input mode="plan">inspect repo</user_input>',
						},
					],
				},
			]),
			"utf8",
		);

		const messages = await readPersistedMessagesFile(messagesPath);

		expect(messages[0]?.content).toBe("spawn a team of agents");
		expect(messages[1]?.content).toBe("Working on it.");
		expect(messages[2]?.content).toEqual([
			{
				type: "text",
				text: "inspect repo",
			},
		]);
	});
});
