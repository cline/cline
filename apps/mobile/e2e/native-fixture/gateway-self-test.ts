#!/usr/bin/env bun
/** Exercise shipping REST parsers against the fixture, not just raw JSON statuses. */
import { readFileSync } from "node:fs";
import { CloudSessionGateway } from "../../src/cloud/rest/CloudSessionGateway";

const configPath = process.env.FIXTURE_CONFIG_PATH;
if (!configPath) throw new Error("Set FIXTURE_CONFIG_PATH");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const makeGateway = (organizationId?: string) =>
	new CloudSessionGateway({
		apiBaseUrl: config.base,
		getAccessToken: async () => config.token,
		organizationId,
		provisioningPollMs: 20,
		provisioningTimeoutMs: 2000,
	});
const personal = makeGateway(),
	org = makeGateway("fixture-contract-org"),
	otherOrg = makeGateway("fixture-contract-other-org");
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
const created: any[] = [];
const input = {
	modelId: "anthropic/claude-sonnet-4-6",
	repoUrl: "https://github.com/fixture/native-fixture",
	branch: "fixture-safe-branch",
};
try {
	const p = await personal.createRemoteSession({
		...input,
		title: "Gateway Personal contract",
	});
	created.push(p);
	const o = await org.createRemoteSession({
		...input,
		title: "Gateway Organization contract",
	});
	created.push(o);
	const pRows = await personal.listRemoteSessions(),
		oRows = await org.listRemoteSessions();
	assert(
		pRows.some((row) => row.id === p.sessionId) &&
			!pRows.some((row) => row.id === o.sessionId),
		"Personal list must exclude Organization rows",
	);
	assert(
		oRows.some(
			(row) =>
				row.id === o.sessionId && row.organizationId === "fixture-contract-org",
		) && !oRows.some((row) => row.id === p.sessionId),
		"Organization list must exclude Personal rows",
	);
	assert(
		(await otherOrg.listRemoteSessions()).length === 0,
		"Other organization must not duplicate Personal rows",
	);
	console.log(
		"PASS actual Gateway create/list identity and Personal/organization isolation",
	);
	const found = await personal.getRemoteSession(p.sessionId);
	assert(
		found?.id === p.sessionId &&
			found.status === "running" &&
			found.branch === "fixture-safe-branch",
		"Actual Gateway get/status must parse same selected row",
	);
	await personal.suspendRemoteSession(p.sessionId);
	assert(
		(await personal.getRemoteSession(p.sessionId))?.status === "suspended",
		"Gateway must confirm suspended DTO, not ambiguous stop",
	);
	const resumed = await personal.resumeSuspendedSession(p.sessionId);
	assert(
		resumed.id === p.sessionId &&
			resumed.status === "running" &&
			resumed.title === "Gateway Personal contract",
		"Gateway must parse resume full SessionDTO with same ID/title",
	);
	console.log("PASS actual Gateway status/suspend/resume parser contracts");
	await personal.updateTitle(p.sessionId, "Gateway renamed contract");
	assert(
		(await personal.getRemoteSession(p.sessionId))?.title ===
			"Gateway renamed contract",
		"Rename must retain canonical row identity",
	);
	assert(
		Array.isArray(await personal.readHistory(p.sessionId)),
		"Gateway history must parse versioned history contract",
	);
	await personal.deleteRemoteSession(p.sessionId);
	created.splice(created.indexOf(p), 1);
	assert(
		!(await personal.listRemoteSessions()).some(
			(row) => row.id === p.sessionId,
		),
		"Gateway delete must remove exact selected row",
	);
	console.log("PASS actual Gateway rename/history/delete parser contracts");
} finally {
	for (const row of created) await personal.deleteRemoteSession(row.sessionId);
}
console.log(
	"Shipping Gateway/fixture contract audit passed; native E2E still required.",
);
