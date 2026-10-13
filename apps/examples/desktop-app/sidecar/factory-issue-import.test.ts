import { describe, expect, it, vi } from "vitest";
import { readFactoryIssue } from "./factory-issue-import";

const linearIssue = {
	id: "72bb0e24-982d-4f58-84e8-27d07aab39af",
	title: "Add keyboard navigation",
	description: "Support navigating the board without a mouse.",
	url: "https://linear.app/example/issue/APP-12/add-keyboard-navigation",
};
const linearInput = { url: linearIssue.url, cwd: "/repo" };

describe("Factory issue import", () => {
	it.each([
		"http://github.com/example/repo/issues/1",
		"https://github.com.evil.test/example/repo/issues/1",
		"https://github.com@example.test/repo/issues/1",
		"https://user:password@github.com/example/repo/issues/1",
		"https://github.com:8443/example/repo/issues/1",
		"https://github.com/example/repo/pull/1",
		"https://linear.app/example/project/APP-12",
		"file:///tmp/issue",
	])("rejects unsupported URLs before any external request: %s", async (url) => {
		const run = vi.fn();
		const fetchImpl = vi.fn<typeof fetch>();
		await expect(
			readFactoryIssue({ url, cwd: "/repo" }, { run, fetchImpl }),
		).rejects.toThrow("issue URL");
		expect(run).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("imports GitHub content and uses the provider identity and canonical URL", async () => {
		const run = vi.fn().mockResolvedValue(
			JSON.stringify({
				id: "I_example",
				title: "Add keyboard navigation",
				body: "Acceptance: arrow keys move between cards.",
				url: "https://github.com/example/renamed/issues/42",
			}),
		);
		const issue = await readFactoryIssue(
			{
				url: "https://github.com/example/original/issues/42?tracking=1#issuecomment-1",
				cwd: "/repo",
			},
			{ run },
		);
		expect(issue).toEqual({
			title: "Add keyboard navigation",
			description: "Acceptance: arrow keys move between cards.",
			source: {
				provider: "github",
				id: "I_example",
				url: "https://github.com/example/renamed/issues/42",
			},
		});
		expect(run).toHaveBeenCalledWith(
			"gh",
			[
				"issue",
				"view",
				"https://github.com/example/original/issues/42",
				"--json",
				"id,title,body,url",
			],
			"/repo",
		);
	});

	it("gives actionable GitHub failure without forwarding private command output", async () => {
		const run = vi.fn().mockRejectedValue(new Error("private command stderr"));
		await expect(
			readFactoryIssue(
				{ url: "https://github.com/example/repo/issues/1", cwd: "/repo" },
				{ run },
			),
		).rejects.toThrow("sign in with gh auth login");
	});

	it.each([
		{ env: { LINEAR_API_KEY: "test-api-key" }, authorization: "test-api-key" },
		{
			env: { LINEAR_ACCESS_TOKEN: "test-oauth-token" },
			authorization: "Bearer test-oauth-token",
		},
	])("reads Linear using the existing connector credentials: $authorization", async ({
		env,
		authorization,
	}) => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ data: { issue: linearIssue } }));
		const issue = await readFactoryIssue(linearInput, { env, fetchImpl });
		expect(issue).toEqual({
			title: linearIssue.title,
			description: linearIssue.description,
			source: {
				provider: "linear",
				id: linearIssue.id,
				url: "https://linear.app/example/issue/APP-12",
			},
		});
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("https://api.linear.app/graphql");
		expect(init?.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: authorization,
		});
		expect(JSON.parse(String(init?.body)).variables).toEqual({ id: "APP-12" });
		expect(init?.redirect).toBe("error");
	});

	it("explains missing Linear credentials before a request", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		await expect(
			readFactoryIssue(linearInput, { env: {}, fetchImpl }),
		).rejects.toThrow("LINEAR_API_KEY or LINEAR_ACCESS_TOKEN");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		{
			data: { issue: linearIssue },
			errors: [{ message: "private upstream error" }],
		},
		{ data: { issue: null } },
	])("does not import missing or partially failed GraphQL results", async (body) => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(body));
		await expect(
			readFactoryIssue(linearInput, {
				env: { LINEAR_API_KEY: "test-key" },
				fetchImpl,
			}),
		).rejects.toThrow("Check the URL and access");
	});

	it("refuses a same-number issue from a different Linear workspace", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				data: {
					issue: {
						...linearIssue,
						url: "https://linear.app/other-workspace/issue/APP-12",
					},
				},
			}),
		);
		await expect(
			readFactoryIssue(linearInput, {
				env: { LINEAR_API_KEY: "test-key" },
				fetchImpl,
			}),
		).rejects.toThrow("different Linear workspace");
	});
});
