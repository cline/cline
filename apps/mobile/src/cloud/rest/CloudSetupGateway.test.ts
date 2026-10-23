import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	type CloudSetupApiError,
	CloudSetupGateway,
} from "./CloudSetupGateway";

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("CloudSetupGateway", () => {
	it("uses the existing authenticated Cloud API repository endpoint", async () => {
		const fetchImpl = vi.fn(async () =>
			response({
				success: true,
				data: [
					{
						id: 1,
						name: "cline",
						full_name: "cline/cline",
						html_url: "https://github.com/cline/cline",
						clone_url: "https://github.com/cline/cline.git",
						private: false,
						default_branch: "main",
					},
					{
						id: 2,
						name: "removed-repository",
						full_name: "cline/removed-repository",
						html_url: "",
						clone_url: "",
						private: false,
						default_branch: "",
					},
				],
			}),
		);
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.cline.bot",
			getAccessToken: async () => "jwt",
			fetchImpl: fetchImpl as typeof fetch,
		});

		await expect(gateway.listRepositories()).resolves.toEqual([
			{
				id: 1,
				name: "cline",
				fullName: "cline/cline",
				repoUrl: "https://github.com/cline/cline",
				private: false,
				defaultBranch: "main",
			},
		]);
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.cline.bot/api/v1/integrations/github/repositories",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer workos:jwt",
				}),
			}),
		);
	});

	it("coerces desktop-compatible repository rows instead of rejecting the list", async () => {
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.cline.bot",
			getAccessToken: async () => "jwt",
			fetchImpl: vi.fn(async () =>
				response({
					success: true,
					data: [
						{
							id: "42",
							name: null,
							full_name: "cline/cline",
							html_url: "https://github.com/cline/cline",
							clone_url: "https://github.com/cline/cline.git",
							private: true,
						},
					],
				}),
			) as typeof fetch,
		});

		await expect(gateway.listRepositories()).resolves.toEqual([
			{
				id: 42,
				name: "",
				fullName: "cline/cline",
				repoUrl: "https://github.com/cline/cline",
				private: true,
			},
		]);
	});

	it("deduplicates recommendations and always offers the Cline default", async () => {
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.cline.bot",
			getAccessToken: async () => null,
			fetchImpl: vi.fn(async (url) =>
				response(
					String(url).endsWith("/models")
						? { data: [] }
						: {
								recommended: [
									{ id: "model-a", name: "Model A", tags: ["Best"] },
								],
								free: [{ id: "model-a", name: "Model A" }],
								clinePass: [],
							},
				),
			) as typeof fetch,
		});
		const models = await gateway.listRecommendedModels();
		expect(models.map((model) => model.id)).toEqual([
			CLINE_DEFAULT_MODEL_ID,
			"model-a",
		]);
		expect(models.find((model) => model.id === "model-a")?.tier).toBe(
			"recommended",
		);
	});

	it("resolves curated alias image support only when the catalog slug is unambiguous", async () => {
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => null,
			fetchImpl: (async (url) =>
				response(
					String(url).endsWith("/models")
						? {
								data: [
									{
										id: "z-ai/glm-5.2",
										architecture: { input_modalities: ["text"] },
									},
									{
										id: "z-ai/glm-5.2:free",
										architecture: { input_modalities: ["text"] },
									},
									{
										id: "vendor/vision",
										architecture: { input_modalities: ["text", "image"] },
									},
									{
										id: "one/shared",
										architecture: { input_modalities: ["text"] },
									},
									{
										id: "two/shared",
										architecture: { input_modalities: ["text", "image"] },
									},
								],
							}
						: {
								clineCloud: ["glm-5.2", "vision", "shared", "missing"].map(
									(id) => ({ id: `cline-cloud/${id}`, name: id }),
								),
							},
				)) as typeof fetch,
		});
		const models = await gateway.listRecommendedModels();
		expect(
			models.find((m) => m.id === "cline-cloud/glm-5.2")?.supportsImages,
		).toBe(false);
		expect(
			models.find((m) => m.id === "cline-cloud/vision")?.supportsImages,
		).toBe(true);
		expect(
			models.find((m) => m.id === "cline-cloud/shared")?.supportsImages,
		).toBeUndefined();
		expect(
			models.find((m) => m.id === "cline-cloud/missing")?.supportsImages,
		).toBeUndefined();
	});

	it("merges the full catalog and Cloud recommendations without losing image capabilities", async () => {
		const fetchImpl = vi.fn(async (url) =>
			response(
				String(url).endsWith("/models")
					? {
							data: [
								{
									id: "vision",
									display_name: "Vision model",
									architecture: { input_modalities: ["text", "image"] },
								},
								{
									id: "text",
									name: "Text model",
									architecture: { input_modalities: ["text"] },
								},
								{ id: "unknown", name: "Unknown model" },
								{
									id: "empty",
									name: "Incomplete metadata",
									architecture: { input_modalities: [] },
								},
							],
						}
					: {
							clineCloud: [
								{ id: "vision", name: "Featured vision" },
								{ id: "cloud-only", name: "Cloud only" },
							],
						},
			),
		);
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => null,
			fetchImpl: fetchImpl as typeof fetch,
		});
		const models = await gateway.listRecommendedModels();
		expect(models.find((model) => model.id === "vision")).toMatchObject({
			name: "Featured vision",
			tier: "cloud",
			supportsImages: true,
		});
		expect(models.filter((model) => model.id === "vision")).toHaveLength(1);
		expect(models.find((model) => model.id === "text")?.supportsImages).toBe(
			false,
		);
		expect(
			models.find((model) => model.id === "unknown")?.supportsImages,
		).toBeUndefined();
		expect(
			models.find((model) => model.id === "empty")?.supportsImages,
		).toBeUndefined();
		expect(models.some((model) => model.id === "cloud-only")).toBe(true);
		expect(models.some((model) => model.id === CLINE_DEFAULT_MODEL_ID)).toBe(
			true,
		);
	});

	it("keeps the full catalog available when recommendations fail", async () => {
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => null,
			fetchImpl: vi.fn(async (url) =>
				String(url).endsWith("/models")
					? response({ data: [{ id: "catalog-model", name: "Catalog model" }] })
					: response({}, 503),
			) as typeof fetch,
		});
		await expect(gateway.listRecommendedModels()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "catalog-model" }),
			]),
		);
	});

	it("turns the integration 404 into actionable setup copy", async () => {
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.cline.bot",
			getAccessToken: async () => "jwt",
			fetchImpl: vi.fn(async () =>
				response({ error: "missing" }, 404),
			) as typeof fetch,
		});
		await expect(gateway.listRepositories()).rejects.toMatchObject({
			name: "CloudSetupApiError",
			status: 404,
			message: "Connect GitHub to your Cline account, then try again.",
		} satisfies Partial<CloudSetupApiError>);
	});
});

/**
 * Branch listing rides the API's cursor+query contract:
 * `query` is a repository-wide server-side search — at 30k branches search is
 * the navigation and the page list only the fallback — and `nextToken` is the
 * browse cursor. These pin the URL, the both-param encoding, and the row
 * coercion (one odd row must not hide the page).
 */
describe("listBranches", () => {
	const page = {
		success: true,
		data: {
			items: [{ name: "main" }, { name: " feature/x " }, { name: 7 }, {}],
			nextToken: "cursor-2",
		},
	};

	it("lists one page from the personal endpoint", async () => {
		const fetchImpl = vi.fn(async (_url: string, _init?: unknown) =>
			response(page),
		);
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetchImpl: fetchImpl as never,
		});
		const result = await gateway.listBranches(42);
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			"https://api.test/api/v1/integrations/github/repositories/42/branches",
		);
		expect(result).toEqual({
			branches: ["main", "feature/x"],
			nextToken: "cursor-2",
		});
	});

	it("encodes query and cursor, and uses the org path when scoped", async () => {
		const fetchImpl = vi.fn(async (_url: string, _init?: unknown) =>
			response({ success: true, data: { items: [], nextToken: "" } }),
		);
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetchImpl: fetchImpl as never,
		});
		const result = await gateway.listBranches(42, {
			organizationId: "org_1",
			query: "feature/",
			cursor: "abc",
		});
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			"https://api.test/api/v1/organizations/org_1/integrations/github/repositories/42/branches?query=feature%2F&cursor=abc",
		);
		// An empty nextToken means no more pages, not a page named "".
		expect(result).toEqual({ branches: [] });
	});

	it("flags an unreadable branch payload", async () => {
		const fetchImpl = vi.fn(async () => response({ data: "nope" }));
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetchImpl: fetchImpl as never,
		});
		await expect(gateway.listBranches(42)).rejects.toThrow(
			/branch list this app could not read/,
		);
	});
});
