/** Synthetic account REST state for the explicitly launched native fixture only.
 * The proxy authenticates requests before invoking this router. No production
 * module imports it, and none of its preferences touch real user accounts.
 */
import type { FixtureFaults } from "./faults";
import { scopedFixtureRows } from "./rest-contract";

export const FIXTURE_USER_ID = "fixture-user-00000001";
export const FIXTURE_ORGANIZATIONS = [
	{
		organizationId: "fixture-org-team-a",
		name: "Fixture Team A",
		balance: 42_000_000,
	},
	{
		organizationId: "fixture-org-team-b",
		name: "Fixture Team B",
		balance: 6_500_000,
	},
] as const;

function faultStatus(value: number): number {
	return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 503;
}
function failure(error: string, status: number, allow?: string): Response {
	return Response.json(
		{ success: false, error },
		{ status, ...(allow ? { headers: { Allow: allow } } : {}) },
	);
}
export class FixtureAccounts {
	private activeOrganizationId: string | undefined;
	constructor(
		private readonly options: {
			faults: FixtureFaults;
			record?(kind: string, detail: { organizationId: string | null }): void;
			sleep?(milliseconds: number): Promise<unknown>;
		},
	) {}

	private async delay(scope: string, fault: string) {
		const milliseconds = this.options.faults.get(scope, fault);
		if (milliseconds)
			await (
				this.options.sleep ??
				((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
			)(milliseconds);
	}
	/** Called only after the fixture proxy's isolated-bearer check. */
	async handle(request: Request): Promise<Response | undefined> {
		const path = new URL(request.url).pathname;
		if (path === "/api/v1/users/me") {
			if (request.method !== "GET")
				return failure("Use GET for fixture account discovery", 405, "GET");
			const fault = this.options.faults.get(FIXTURE_USER_ID, "accounts-error");
			if (fault)
				return failure("Fixture accounts unavailable", faultStatus(fault));
			return Response.json({
				data: {
					id: FIXTURE_USER_ID,
					organizations: FIXTURE_ORGANIZATIONS.map(
						({ organizationId, name }) => ({
							organizationId,
							name,
							active: organizationId === this.activeOrganizationId,
						}),
					),
				},
			});
		}
		if (path === "/api/v1/users/active-account") {
			if (request.method !== "PUT")
				return failure("Use PUT for fixture active account", 405, "PUT");
			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return failure("Expected a JSON organizationId or null", 400);
			}
			if (
				!body ||
				typeof body !== "object" ||
				Array.isArray(body) ||
				!("organizationId" in body) ||
				(body.organizationId !== null &&
					typeof body.organizationId !== "string")
			)
				return failure("Expected a JSON organizationId or null", 400);
			const organizationId = body.organizationId;
			if (
				organizationId !== null &&
				!FIXTURE_ORGANIZATIONS.some(
					(org) => org.organizationId === organizationId,
				)
			)
				return failure("Unknown fixture organization membership", 403);
			this.options.record?.("fixture-account-switch-requested", {
				organizationId,
			});
			await this.delay(FIXTURE_USER_ID, "account-switch-delay-ms");
			const fault = this.options.faults.get(
				FIXTURE_USER_ID,
				"account-switch-error",
			);
			if (fault)
				return failure(
					"Fixture account preference unavailable",
					faultStatus(fault),
				);
			this.activeOrganizationId = organizationId ?? undefined;
			this.options.record?.("fixture-active-account-updated", {
				organizationId,
			});
			return Response.json({ success: true });
		}
		if (path === `/api/v1/users/${FIXTURE_USER_ID}/balance`) {
			if (request.method !== "GET")
				return failure("Use GET for fixture balance", 405, "GET");
			if (this.options.faults.get(FIXTURE_USER_ID, "balance-error"))
				return failure("Fixture balance unavailable", 503);
			return Response.json({
				success: true,
				data: { userId: FIXTURE_USER_ID, balance: 12_340_000 },
			});
		}
		const match = path.match(/^\/api\/v1\/organizations\/([^/]+)\/balance$/);
		if (match) {
			if (request.method !== "GET")
				return failure("Use GET for fixture balance", 405, "GET");
			let organizationId: string;
			try {
				organizationId = decodeURIComponent(match[1]);
			} catch {
				return failure("Invalid fixture organization path", 400);
			}
			const organization = FIXTURE_ORGANIZATIONS.find(
				(org) => org.organizationId === organizationId,
			);
			if (!organization)
				return failure("Unknown fixture organization membership", 403);
			if (this.options.faults.get(organizationId, "balance-error"))
				return failure("Fixture balance unavailable", 503);
			return Response.json({
				success: true,
				data: { organizationId, balance: organization.balance },
			});
		}
		const github = path.match(
			/^\/api\/v1\/(?:organizations\/([^/]+)\/)?integrations\/github\/repositories(?:\/([^/]+)\/branches)?$/,
		);
		if (github) {
			if (request.method !== "GET")
				return failure("Use GET for fixture GitHub discovery", 405, "GET");
			let organizationId: string | undefined;
			try {
				organizationId = github[1] ? decodeURIComponent(github[1]) : undefined;
			} catch {
				return failure("Invalid fixture organization path", 400);
			}
			if (
				organizationId &&
				!FIXTURE_ORGANIZATIONS.some(
					(org) => org.organizationId === organizationId,
				)
			)
				return failure("Unknown fixture organization membership", 403);
			const url = new URL(request.url);
			const repositoryId = github[2] ?? url.searchParams.get("repository");
			const scope = organizationId ?? FIXTURE_USER_ID;
			if (repositoryId) {
				if (repositoryId !== "1")
					return failure("Unknown fixture repository", 404);
				await this.delay(scope, "branches-delay-ms");
				if (this.options.faults.get(scope, "branches-error"))
					return failure("Fixture branches unavailable", 503);
				const query = url.searchParams.get("query")?.trim().toLowerCase() ?? "";
				return Response.json({
					data: {
						items: this.options.faults.get(scope, "branches-empty")
							? []
							: ["main", "fixture-safe-branch"]
									.filter((name) => name.toLowerCase().includes(query))
									.map((name) => ({ name })),
						nextToken: null,
					},
				});
			}
			await this.delay(scope, "repositories-delay-ms");
			if (this.options.faults.get(scope, "repositories-error"))
				return failure("Fixture GitHub integration unavailable", 403);
			return Response.json({
				data: this.options.faults.get(scope, "repositories-empty")
					? []
					: [
							{
								id: 1,
								name: "native-fixture",
								full_name: "fixture/native-fixture",
								html_url: "https://github.com/fixture/native-fixture",
								clone_url: "https://github.com/fixture/native-fixture.git",
								private: true,
								default_branch: "main",
							},
						],
			});
		}
		return undefined;
	}
}

/** Capture an exact scope at request admission, then hold only its reply. */
export async function fixtureSessionList<
	T extends { organizationId?: unknown },
>(input: {
	rows: T[];
	organizationId?: string;
	faults: FixtureFaults;
	sleep(milliseconds: number): Promise<unknown>;
}): Promise<T[]> {
	const rows = structuredClone(
		scopedFixtureRows(input.rows, input.organizationId),
	);
	const delay = input.faults.get(
		input.organizationId ?? FIXTURE_USER_ID,
		"list-delay-ms",
	);
	if (delay) await input.sleep(delay);
	return rows;
}
