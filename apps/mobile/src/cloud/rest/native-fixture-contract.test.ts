/** The shipping parser consumes the exact response builders used by native fixtures. */
import { describe, expect, it } from "vitest";
import {
	fixtureLifecycleDto,
	scopedFixtureRows,
} from "../../../e2e/native-fixture/rest-contract";
import { asRemoteSessionId } from "../../session";
import { CloudSessionGateway } from "./CloudSessionGateway";

describe("native fixture shipping Gateway contracts", () => {
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
