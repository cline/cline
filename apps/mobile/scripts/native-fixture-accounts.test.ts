import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAccountGateway } from "@/cloud/rest/CloudAccountGateway";
import { CloudSessionGateway } from "@/cloud/rest/CloudSessionGateway";
import { CloudSetupGateway } from "@/cloud/rest/CloudSetupGateway";
import {
	FIXTURE_ORGANIZATIONS,
	FIXTURE_USER_ID,
	FixtureAccounts,
	fixtureSessionList,
} from "../e2e/native-fixture/accounts";
import { FixtureFaults } from "../e2e/native-fixture/faults";
import { scopedFixtureRows } from "../e2e/native-fixture/rest-contract";

const TEAM_A = "fixture-org-team-a",
	TEAM_B = "fixture-org-team-b";
function harness() {
	const faults = new FixtureFaults();
	const record = vi.fn();
	const accounts = new FixtureAccounts({ faults, record });
	const calls: Array<{ path: string; method: string; body: string }> = [];
	const fetch = (async (input, init) => {
		const request = new Request(
			input instanceof Request ? input : String(input),
			init,
		);
		calls.push({
			path: new URL(request.url).pathname,
			method: request.method,
			body: await request.clone().text(),
		});
		return (
			(await accounts.handle(request)) ??
			Response.json({ error: "Fixture route not found" }, { status: 404 })
		);
	}) as typeof globalThis.fetch;
	const gateway = new CloudAccountGateway({
		apiBaseUrl: "https://fixture.invalid",
		getAccessToken: async () => "synthetic-fixture-token",
		fetch,
	});
	return { faults, record, accounts, gateway, calls, fetch };
}

describe("opt-in native fixture account HTTP contracts", () => {
	it("feeds actual account discovery and USD balance parsers with two memberships and three distinct balances", async () => {
		const { gateway, calls } = harness();
		expect(await gateway.listAccounts()).toEqual([
			{ name: "Personal", active: true },
			{ name: "Fixture Team A", organizationId: TEAM_A, active: false },
			{ name: "Fixture Team B", organizationId: TEAM_B, active: false },
		]);
		expect(await gateway.creditBalance()).toBe(12.34);
		expect(await gateway.creditBalance(TEAM_A)).toBe(42);
		expect(await gateway.creditBalance(TEAM_B)).toBe(6.5);
		expect(calls.map((call) => call.path)).toEqual([
			"/api/v1/users/me",
			"/api/v1/users/me",
			`/api/v1/users/${FIXTURE_USER_ID}/balance`,
			`/api/v1/organizations/${TEAM_A}/balance`,
			`/api/v1/organizations/${TEAM_B}/balance`,
		]);
		expect(FIXTURE_ORGANIZATIONS).toHaveLength(2);
	});
	it("uses the real PUT URL and JSON null/string contract and reports only the fake preference as active", async () => {
		const { gateway, calls, record } = harness();
		for (const organizationId of [TEAM_A, TEAM_B, undefined]) {
			await gateway.switchAccount(organizationId);
			expect(
				(await gateway.listAccounts())
					.filter((account) => account.active)
					.map((account) => account.organizationId),
			).toEqual([organizationId]);
		}
		expect(calls.filter((call) => call.method === "PUT")).toEqual([
			{
				method: "PUT",
				path: "/api/v1/users/active-account",
				body: JSON.stringify({ organizationId: TEAM_A }),
			},
			{
				method: "PUT",
				path: "/api/v1/users/active-account",
				body: JSON.stringify({ organizationId: TEAM_B }),
			},
			{
				method: "PUT",
				path: "/api/v1/users/active-account",
				body: JSON.stringify({ organizationId: null }),
			},
		]);
		expect(
			record.mock.calls.filter(
				([kind]) => kind === "fixture-active-account-updated",
			),
		).toHaveLength(3);
	});
	it.each([
		"{}",
		"null",
		"[]",
		'{"organizationId":12}',
		"not JSON",
		'{"organizationId":"foreign-org"}',
		'{"organizationId":""}',
	])("rejects invalid/foreign preference body %s without changing the active account", async (body) => {
		const { gateway, accounts, record } = harness();
		await gateway.switchAccount(TEAM_A);
		const response = await accounts.handle(
			new Request("https://fixture.invalid/api/v1/users/active-account", {
				method: "PUT",
				body,
			}),
		);
		expect(response?.status).toBe(
			body.includes("foreign-org") || body.includes('""') ? 403 : 400,
		);
		expect(
			(await gateway.listAccounts()).find((account) => account.active)
				?.organizationId,
		).toBe(TEAM_A);
		expect(
			record.mock.calls.filter(
				([kind]) => kind === "fixture-active-account-updated",
			),
		).toHaveLength(1);
	});
	it("rejects wrong methods and unknown account paths without mutating preferences", async () => {
		const { accounts, gateway } = harness();
		for (const [path, method, allowed] of [
			["/api/v1/users/active-account", "POST", "PUT"],
			["/api/v1/users/active-account", "GET", "PUT"],
			["/api/v1/users/me", "PUT", "GET"],
			[`/api/v1/organizations/${TEAM_A}/balance`, "POST", "GET"],
		]) {
			const response = await accounts.handle(
				new Request(`https://fixture.invalid${path}`, { method }),
			);
			expect(response?.status).toBe(405);
			expect(response?.headers.get("Allow")).toBe(allowed);
		}
		expect(
			await accounts.handle(
				new Request("https://fixture.invalid/api/v1/users/other-user/balance"),
			),
		).toBeUndefined();
		expect(
			(
				await accounts.handle(
					new Request(
						"https://fixture.invalid/api/v1/organizations/foreign-org/balance",
					),
				)
			)?.status,
		).toBe(403);
		expect(
			(await gateway.listAccounts()).find((account) => account.active)
				?.organizationId,
		).toBeUndefined();
	});
	it("exposes controlled GET/PUT failures through the shipping Gateway while preserving fake active preference", async () => {
		const { faults, gateway, record } = harness();
		await gateway.switchAccount(TEAM_A);
		faults.set("global", "accounts-error", 1);
		await expect(gateway.listAccounts()).rejects.toMatchObject({ status: 503 });
		faults.set("global", "accounts-error", 0);
		faults.set("global", "account-switch-error", 1);
		await expect(gateway.switchAccount(TEAM_B)).rejects.toMatchObject({
			status: 503,
		});
		expect(
			(await gateway.listAccounts()).find((account) => account.active)
				?.organizationId,
		).toBe(TEAM_A);
		expect(
			record.mock.calls.filter(
				([kind]) => kind === "fixture-active-account-updated",
			),
		).toHaveLength(1);
		faults.set("global", "account-switch-error", 0);
		await gateway.switchAccount(TEAM_B);
		expect(
			(await gateway.listAccounts()).find((account) => account.active)
				?.organizationId,
		).toBe(TEAM_B);
		faults.set(TEAM_A, "balance-error", 1);
		await expect(gateway.creditBalance(TEAM_A)).rejects.toMatchObject({
			status: 503,
		});
		expect(await gateway.creditBalance(TEAM_B)).toBe(6.5);
		expect(await gateway.creditBalance()).toBe(12.34);
	});
	it("keeps session query scoping explicit and independent of the fake active-account preference", async () => {
		const { gateway, fetch } = harness();
		await gateway.switchAccount(TEAM_B);
		const rows = [undefined, TEAM_A, TEAM_B].map((organizationId, index) => ({
			id: `fixture-scope-${index}`,
			status: "running",
			sandboxType: "resumable",
			sandboxUrl: `https://fixture.invalid/workspace/${index}`,
			...(organizationId ? { organizationId } : {}),
			metadata: { taskId: `task-${index}` },
		}));
		const queries: Array<string | null> = [];
		const transport = (async (input, init) => {
			const url = new URL(String(input));
			if (url.pathname !== "/api/v1/session") return fetch(input, init);
			expect(init?.method).toBe("GET");
			queries.push(url.searchParams.get("organizationId"));
			return Response.json({
				success: true,
				data: scopedFixtureRows(
					rows,
					url.searchParams.get("organizationId") || undefined,
				),
			});
		}) as typeof globalThis.fetch;
		for (const [index, organizationId] of [
			undefined,
			TEAM_A,
			TEAM_B,
		].entries()) {
			const sessions = await new CloudSessionGateway({
				apiBaseUrl: "https://fixture.invalid",
				organizationId,
				getAccessToken: async () => "synthetic-fixture-token",
				fetchImpl: transport,
			}).listRemoteSessions({ refreshProvisioning: false });
			expect(sessions.map((session) => session.id)).toEqual([
				`fixture-scope-${index}`,
			]);
			expect(
				sessions.every((session) => session.organizationId === organizationId),
			).toBe(true);
		}
		expect(queries).toEqual([null, TEAM_A, TEAM_B]);
	});
});

afterEach(() => vi.useRealTimers());
it("holds a valid account PUT before mutation, records admission, then updates the fake preference once", async () => {
	vi.useFakeTimers();
	const { gateway, faults, record } = harness();
	faults.set("global", "account-switch-delay-ms", 2000);
	const switching = gateway.switchAccount(TEAM_A);
	await vi.advanceTimersByTimeAsync(0);
	expect(record).toHaveBeenCalledWith("fixture-account-switch-requested", {
		organizationId: TEAM_A,
	});
	expect(
		(await gateway.listAccounts()).find((account) => account.active)
			?.organizationId,
	).toBeUndefined();
	await vi.advanceTimersByTimeAsync(1999);
	expect(
		(await gateway.listAccounts()).find((account) => account.active)
			?.organizationId,
	).toBeUndefined();
	await vi.advanceTimersByTimeAsync(1);
	await switching;
	expect(
		(await gateway.listAccounts()).find((account) => account.active)
			?.organizationId,
	).toBe(TEAM_A);
	expect(
		record.mock.calls.filter(
			([kind]) => kind === "fixture-active-account-updated",
		),
	).toHaveLength(1);
	expect(() => faults.set("global", "account-switch-delay-ms", 60001)).toThrow(
		"invalid value",
	);
});
it.each([
	401, 403, 500,
])("preserves typed HTTP%s GET/PUT failures without changing fake preference", async (status) => {
	const { gateway, faults } = harness();
	faults.set("global", "accounts-error", status);
	await expect(gateway.listAccounts()).rejects.toMatchObject({ status });
	faults.set("global", "accounts-error", 0);
	faults.set("global", "account-switch-error", status);
	await expect(gateway.switchAccount(TEAM_A)).rejects.toMatchObject({ status });
	expect(
		(await gateway.listAccounts()).find((account) => account.active)
			?.organizationId,
	).toBeUndefined();
});
it("accepts exact Personal/organization repository and branch Gateway URLs", async () => {
	const { fetch, calls } = harness();
	const setup = new CloudSetupGateway({
		apiBaseUrl: "https://fixture.invalid",
		getAccessToken: async () => "synthetic-fixture-token",
		fetchImpl: fetch,
	});
	for (const organizationId of [undefined, TEAM_A, TEAM_B]) {
		const repositories = await setup.listRepositories(organizationId);
		expect(repositories.map((repository) => repository.id)).toEqual([1]);
		expect(
			await setup.listBranches(1, {
				organizationId,
				query: "main",
				cursor: "fixture-cursor",
			}),
		).toEqual({ branches: ["main"] });
	}
	expect(calls.map((call) => call.path)).toEqual([
		"/api/v1/integrations/github/repositories",
		"/api/v1/integrations/github/repositories/1/branches",
		`/api/v1/organizations/${TEAM_A}/integrations/github/repositories`,
		`/api/v1/organizations/${TEAM_A}/integrations/github/repositories/1/branches`,
		`/api/v1/organizations/${TEAM_B}/integrations/github/repositories`,
		`/api/v1/organizations/${TEAM_B}/integrations/github/repositories/1/branches`,
	]);
	await expect(setup.listRepositories("unknown-team")).rejects.toMatchObject({
		status: 403,
	});
	await expect(
		setup.listBranches(99, { organizationId: TEAM_A }),
	).rejects.toMatchObject({ status: 404 });
});
it("holds only the admitted session scope, retaining its snapshot while other scope replies proceed", async () => {
	vi.useFakeTimers();
	const faults = new FixtureFaults();
	faults.set(TEAM_A, "list-delay-ms", 2000);
	const rows = [
		{ id: "personal" },
		{ id: "team-a", organizationId: TEAM_A },
		{ id: "team-b", organizationId: TEAM_B },
	];
	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));
	const old = fixtureSessionList({
		rows,
		organizationId: TEAM_A,
		faults,
		sleep,
	});
	expect(
		await fixtureSessionList({ rows, organizationId: TEAM_B, faults, sleep }),
	).toEqual([rows[2]]);
	rows[1].id = "changed-after-admission";
	await vi.advanceTimersByTimeAsync(2000);
	expect(await old).toEqual([{ id: "team-a", organizationId: TEAM_A }]);
});
