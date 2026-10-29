/** The shipping parser consumes the exact response builders used by native fixtures. */
import { describe, expect, it } from "vitest";
import {
	FixtureFaults,
	fixtureSessionListFailure,
	fixtureStatusAuthenticationFailure,
} from "../../../e2e/native-fixture/faults";
import {
	fixtureLifecycleDto,
	scopedFixtureRows,
} from "../../../e2e/native-fixture/rest-contract";
import { asRemoteSessionId } from "../../session";
import { CloudSessionGateway } from "./CloudSessionGateway";

describe("native fixture shipping Gateway contracts", () => {
	it.each([
		[1, 503],
		[401, 401],
		[403, 403],
	])("preserves a controlled list fault%s as HTTP%s and clears it without replay", async (value, status) => {
		const faults = new FixtureFaults();
		let requests = 0;
		const gateway = new CloudSessionGateway({
			apiBaseUrl: "http://fixture",
			getAccessToken: async () => "fixture",
			fetchImpl: async () => {
				requests += 1;
				return (
					fixtureSessionListFailure(faults) ??
					Response.json({ success: true, data: [] })
				);
			},
		});
		faults.set("global", "list-error", value);
		await expect(gateway.listRemoteSessions()).rejects.toMatchObject({
			status,
		});
		expect(requests).toBe(1);
		faults.set("global", "list-error", 0);
		expect(await gateway.listRemoteSessions()).toEqual([]);
		expect(requests).toBe(2);
		expect(fixtureSessionListFailure(faults, true)?.status).toBe(503);
	});
	it("scopes opt-in status401 to one outer workspace and preserves typed authentication metadata", async () => {
		const faults = new FixtureFaults();
		expect(() => faults.set("global", "status-auth-error", 1)).toThrow(
			"exact workspace id",
		);
		faults.set("owned-401", "status-auth-error", 1);
		expect(
			fixtureStatusAuthenticationFailure(faults, "other-workspace"),
		).toBeUndefined();
		const gateway = new CloudSessionGateway({
			apiBaseUrl: "http://fixture",
			getAccessToken: async () => "fixture",
			fetchImpl: async (url) => {
				if (new URL(url).pathname.endsWith("/status"))
					return fixtureStatusAuthenticationFailure(faults, "owned-401")!;
				return Response.json({
					success: true,
					data: [
						{ id: "owned-401", status: "running", sandboxType: "resumable" },
					],
				});
			},
		});
		await expect(
			gateway.getRemoteSession(asRemoteSessionId("owned-401")),
		).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
		faults.set("owned-401", "status-auth-error", 0);
		expect(
			fixtureStatusAuthenticationFailure(faults, "owned-401"),
		).toBeUndefined();
	});
	it("confirms suspend and resume through complete SessionDTO, retaining selected identity", async () => {
		const row = {
			id: "fixture-owned-7",
			status: "running",
			sandboxType: "resumable",
			title: "Owned native task",
			metadata: { taskId: "inner-7", modelId: "fixture-model" },
		};
		const gateway = new CloudSessionGateway({
			apiBaseUrl: "http://fixture",
			getAccessToken: async () => "fixture",
			fetchImpl: async (url) => {
				const path = new URL(url).pathname;
				if (path.endsWith("/suspend"))
					return Response.json({
						success: true,
						data: fixtureLifecycleDto(row, "suspend"),
					});
				if (path.endsWith("/resume"))
					return Response.json({
						success: true,
						data: fixtureLifecycleDto(row, "resume"),
					});
				if (path.endsWith("/status"))
					return Response.json({
						success: true,
						data: { sessionId: row.id, status: row.status },
					});
				return Response.json({ success: true, data: [row] });
			},
		});
		await expect(
			gateway.suspendRemoteSession(asRemoteSessionId(row.id)),
		).resolves.toBeUndefined();
		expect(row.status).toBe("suspended");
		expect(
			await gateway.getRemoteSession(asRemoteSessionId(row.id)),
		).toMatchObject({ id: row.id, status: "suspended", taskId: "inner-7" });
		expect(
			await gateway.resumeSuspendedSession(asRemoteSessionId(row.id)),
		).toMatchObject({
			id: row.id,
			status: "running",
			title: row.title,
			taskId: "inner-7",
		});
	});
	it("does not project Personal tasks into cached organization scopes or leak organization tasks into Personal", async () => {
		const rows = [
			{ id: "personal", status: "running" },
			{ id: "org-a", status: "running", organizationId: "org-a" },
			{ id: "org-b", status: "running", organizationId: "org-b" },
		];
		const gateway = (organizationId?: string) =>
			new CloudSessionGateway({
				apiBaseUrl: "http://fixture",
				getAccessToken: async () => "fixture",
				organizationId,
				fetchImpl: async (url) =>
					Response.json({
						success: true,
						data: scopedFixtureRows(
							rows,
							new URL(url).searchParams.get("organizationId") || undefined,
						),
					}),
			});
		expect((await gateway().listRemoteSessions()).map((row) => row.id)).toEqual(
			["personal"],
		);
		expect(
			(await gateway("org-a").listRemoteSessions()).map((row) => row.id),
		).toEqual(["org-a"]);
		expect(await gateway("empty-cached-org").listRemoteSessions()).toEqual([]);
	});
});
