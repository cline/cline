import { describe, expect, it, vi } from "vitest";
import { asRemoteSessionId } from "../../session";
import { CloudSessionGateway } from "./CloudSessionGateway";

const id = asRemoteSessionId("persistent-1");
const dto = {
	id,
	status: "suspended",
	sandboxType: "resumable",
	metadata: { taskId: "task-1" },
};
const response = (data: unknown, status = 200) =>
	new Response(
		JSON.stringify({
			success: status < 400,
			data,
			error: status >= 400 ? "Instance limit reached" : undefined,
		}),
		{ status },
	);

function setup(replies: Response[]) {
	const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
		const next = replies.shift();
		if (!next) throw new Error("Unexpected fetch");
		return next;
	});
	const gateway = new CloudSessionGateway({
		apiBaseUrl: "https://cloud.test",
		getAccessToken: async () => "jwt",
		fetchImpl,
	});
	return { gateway, fetchImpl };
}

describe("persistent Cloud API contract", () => {
	it("requests resumable storage for every new mobile workspace", async () => {
		const { gateway, fetchImpl } = setup([
			response({ sessionId: id, status: "ready" }),
		]);
		await gateway.createRemoteSession({ modelId: "model", repoUrl: "repo" });
		expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
			sandboxType: "resumable",
		});
	});
	it.each([
		"top-level",
		"metadata",
	])("lists a paused %s workspace without waking it", async (shape) => {
		const row =
			shape === "top-level"
				? dto
				: {
						...dto,
						sandboxType: undefined,
						metadata: { ...dto.metadata, sandboxType: "resumable" },
					};
		const { gateway, fetchImpl } = setup([response([row])]);
		expect(await gateway.listRemoteSessions()).toMatchObject([
			{ status: "suspended", sandboxType: "resumable", taskId: "task-1" },
		]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl.mock.calls[0][1]?.method).toBe("GET");
	});
	it("checks live status when opening a stale-ready persistent workspace", async () => {
		const { gateway, fetchImpl } = setup([
			response([{ ...dto, status: "ready" }]),
			response({ sessionId: id, status: "suspended" }),
		]);
		expect(await gateway.getRemoteSession(id)).toMatchObject({
			status: "suspended",
		});
		expect(fetchImpl.mock.calls[1][0]).toBe(
			`https://cloud.test/api/v1/session/${id}/status`,
		);
	});
	it("resumes with authentication and preserves canonical task identity", async () => {
		const { gateway, fetchImpl } = setup([
			response({ ...dto, status: "provisioning" }),
		]);
		expect(await gateway.resumeSuspendedSession(id)).toMatchObject({
			id,
			taskId: "task-1",
			status: "provisioning",
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			`https://cloud.test/api/v1/session/${id}/resume`,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer workos:jwt",
				}),
			}),
		);
	});
	it.each([
		401, 403, 429, 502,
	])("preserves a %s resume failure without retrying or creating", async (status) => {
		const { gateway, fetchImpl } = setup([response(undefined, status)]);
		await expect(gateway.resumeSuspendedSession(id)).rejects.toMatchObject({
			status,
			message: "Instance limit reached",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
	it("accepts a concurrent resume only after checking this workspace is live", async () => {
		const { gateway } = setup([
			response(undefined, 409),
			response([dto]),
			response({ sessionId: id, status: "provisioning" }),
		]);
		expect(await gateway.resumeSuspendedSession(id)).toMatchObject({
			id,
			status: "provisioning",
		});
	});
	it("does not turn a paused conflict into a successful resume", async () => {
		const { gateway } = setup([
			response(undefined, 409),
			response([dto]),
			response({ sessionId: id, status: "suspended" }),
		]);
		await expect(gateway.resumeSuspendedSession(id)).rejects.toMatchObject({
			status: 409,
		});
	});
	it("rejects a response for another workspace", async () => {
		const { gateway } = setup([
			response({ ...dto, id: "another", status: "ready" }),
		]);
		await expect(gateway.resumeSuspendedSession(id)).rejects.toThrow(
			"requested workspace",
		);
	});
	it("does not dispatch an already-cancelled resume", async () => {
		const { gateway, fetchImpl } = setup([]);
		const abort = new AbortController();
		abort.abort(new Error("Cancelled"));
		await expect(
			gateway.resumeSuspendedSession(id, { signal: abort.signal }),
		).rejects.toThrow("Cancelled");
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
