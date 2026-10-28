#!/usr/bin/env bun
/** Read-only snapshot through existing REST routes; safe before upgrading fixture server. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	attachmentMessages,
	type SubmittedAttachments,
} from "./attachment-history";

const configPath = process.env.FIXTURE_CONFIG_PATH;
if (!configPath) throw new Error("Set FIXTURE_CONFIG_PATH");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const headers = { Authorization: `Bearer workos:${config.token}` };
const reply = await fetch(`${config.base}/api/v1/session`, { headers });
if (!reply.ok) throw new Error("Cannot snapshot fixture list");
const allRows = await fetch(`${config.base}/control/state`, {
	headers: { "x-fixture-key": config.controlKey },
});
const rows = allRows.ok
	? (await allRows.json()).rows
	: (await reply.json()).data;
const entries = [];
const sources = [
	resolve(config.stateDir, "events.json"),
	process.env.FIXTURE_ATTACHMENT_EVENTS_PATH,
].filter((path): path is string => !!path && existsSync(path));
const submitted: SubmittedAttachments[] = sources.flatMap((path) =>
	JSON.parse(readFileSync(path, "utf8"))
		.filter((event: any) => event.kind === "prompt")
		.map((event: any) => event.detail),
);
for (const row of rows) {
	const history = await fetch(
		`${config.base}/api/v1/session/${row.id}/history`,
		{ headers },
	);
	if (!history.ok) throw new Error(`Cannot snapshot ${row.id}`);
	entries.push({
		row,
		messages: attachmentMessages(
			(await history.json()).messages,
			submitted.filter((input) => input.sessionId === row.metadata.taskId),
		),
	});
}
writeFileSync(
	resolve(config.stateDir, "restore.json"),
	JSON.stringify({ entries }, null, 2),
	{ mode: 0o600 },
);
console.log(
	`Snapshot saved ${entries.length} fixture workspace IDs and histories.`,
);
