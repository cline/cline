/** Existing Cloud API discovery APIs needed before a Cloud session exists. */

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import { z } from "zod";
import { formatCloudCredential } from "../auth/credential";
import type { CloudCatalogId } from "../model-catalog";
import { modelDisplayName } from "../model-display";

type FetchLike = typeof globalThis.fetch;

// GitHub installation metadata can retain a repository row after access has
// been removed. The Cloud API serializes that stale row with empty URL/branch
// fields. Match Cline desktop: validate the envelope, then coerce/filter
// rows independently so one stale repository cannot hide every usable one.
const repositorySchema = z.looseObject({
	id: z.unknown().optional(),
	name: z.unknown().optional(),
	full_name: z.unknown().optional(),
	html_url: z.unknown().optional(),
	clone_url: z.unknown().optional(),
	private: z.unknown().optional(),
	default_branch: z.unknown().optional(),
});

const repositoryResponseSchema = z.looseObject({
	data: z.array(repositorySchema),
});

const recommendedModelSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

const modelsResponseSchema = z.looseObject({
	recommended: z.array(recommendedModelSchema).optional(),
	free: z.array(recommendedModelSchema).optional(),
	clinePass: z.array(recommendedModelSchema).optional(),
	clineCloud: z.array(recommendedModelSchema).optional(),
});

const catalogModelSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().nullish(),
	display_name: z.string().nullish(),
	displayName: z.string().nullish(),
	supported_parameters: z.array(z.string()).nullish(),
	description: z.string().nullish(),
	tags: z.array(z.string()).nullish(),
	architecture: z
		.looseObject({ input_modalities: z.array(z.string()).nullish() })
		.nullish(),
});
const catalogResponseSchema = z.looseObject({ data: z.array(z.unknown()) });

// `lib.Response[GitHubBranchPage]`: `{ data: { items, nextToken } }`. Rows are
// coerced independently, like repositories, so one odd row cannot hide a page.
const branchSchema = z.looseObject({ name: z.unknown().optional() });
const branchesResponseSchema = z.looseObject({
	data: z.looseObject({
		items: z.array(branchSchema).nullish(),
		nextToken: z.string().nullish(),
	}),
});

export interface CloudBranchPage {
	branches: string[];
	/** Present while the repository has more pages. */
	nextToken?: string;
}

export interface CloudRepository {
	id: number;
	name: string;
	fullName: string;
	repoUrl: string;
	private: boolean;
	defaultBranch?: string;
}

export interface CloudModelOption {
	id: string;
	/** Cloud offer; distinct from the Hub runtime provider (always cline). */
	catalogId?: CloudCatalogId;
	/** Local catalogs can expose the same model ID through multiple providers. */
	providerId?: string;
	name: string;
	/** Absent when the catalog did not declare supported input modalities. */
	supportsImages?: boolean;
	supportsReasoning?: boolean;
	description?: string;
	tags: readonly string[];
	/** Featured feed section, when the Cloud catalog supplied one. */
	tier?: "recommended" | "free" | "subscribed" | "cloud";
}

export class CloudSetupApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "CloudSetupApiError";
	}
}

export interface CloudSetupGatewayOptions {
	apiBaseUrl: string;
	getAccessToken(): Promise<string | null>;
	fetchImpl?: FetchLike;
}

export class CloudSetupGateway {
	constructor(private readonly options: CloudSetupGatewayOptions) {}

	async listRepositories(organizationId?: string): Promise<CloudRepository[]> {
		const path = organizationId
			? `/api/v1/organizations/${encodeURIComponent(organizationId)}/integrations/github/repositories`
			: "/api/v1/integrations/github/repositories";
		const response = await this.fetch(path, true);
		const parsed = repositoryResponseSchema.safeParse(await response.json());
		if (!parsed.success) {
			throw new CloudSetupApiError(
				"Cline returned a repository list this app could not read.",
				response.status,
			);
		}
		return parsed.data.data.flatMap((repo) => {
			const id = Number(repo.id);
			const htmlUrl =
				typeof repo.html_url === "string" ? repo.html_url.trim() : "";
			const cloneUrl =
				typeof repo.clone_url === "string" ? repo.clone_url.trim() : "";
			const repoUrl = htmlUrl || cloneUrl;
			if (!Number.isSafeInteger(id) || id <= 0 || !repoUrl) return [];

			const name = typeof repo.name === "string" ? repo.name.trim() : "";
			const fullName =
				typeof repo.full_name === "string" ? repo.full_name.trim() : "";
			const defaultBranch =
				typeof repo.default_branch === "string"
					? repo.default_branch.trim()
					: "";
			return [
				{
					id,
					name,
					fullName: fullName || name || repoUrl,
					repoUrl,
					private: repo.private === true,
					...(defaultBranch ? { defaultBranch } : {}),
				},
			];
		});
	}

	/**
	 * One page of branch names, newest contract from Cloud API: `query` is a
	 * repository-wide server-side search (GitHub GraphQL underneath), `cursor` the
	 * previous page's `nextToken`. At 30k branches search is the navigation; the
	 * page list is only the browsing fallback.
	 */
	async listBranches(
		repositoryId: number,
		options: {
			organizationId?: string;
			query?: string;
			cursor?: string;
		} = {},
	): Promise<CloudBranchPage> {
		const base = options.organizationId
			? `/api/v1/organizations/${encodeURIComponent(options.organizationId)}/integrations/github/repositories`
			: "/api/v1/integrations/github/repositories";
		const params = new URLSearchParams();
		if (options.query?.trim()) params.set("query", options.query.trim());
		if (options.cursor) params.set("cursor", options.cursor);
		const search = params.size > 0 ? `?${params.toString()}` : "";
		const response = await this.fetch(
			`${base}/${encodeURIComponent(String(repositoryId))}/branches${search}`,
			true,
		);
		const parsed = branchesResponseSchema.safeParse(await response.json());
		if (!parsed.success) {
			throw new CloudSetupApiError(
				"Cline returned a branch list this app could not read.",
				response.status,
			);
		}
		const branches = (parsed.data.data.items ?? []).flatMap((branch) =>
			typeof branch.name === "string" && branch.name.trim()
				? [branch.name.trim()]
				: [],
		);
		const nextToken = parsed.data.data.nextToken?.trim();
		return { branches, ...(nextToken ? { nextToken } : {}) };
	}

	async listRecommendedModels(): Promise<CloudModelOption[]> {
		// The full catalog is authoritative; recommendations are optional curation.
		const [response, recommendations] = await Promise.all([
			this.fetch("/api/v1/ai/cline/models", false),
			this.fetch("/api/v1/ai/cline/recommended-models", false)
				.then(async (result) =>
					modelsResponseSchema.safeParse(await result.json()),
				)
				.catch(() => undefined),
		]);
		const parsed = catalogResponseSchema.safeParse(await response.json());
		if (!parsed.success) {
			throw new CloudSetupApiError(
				"Cline returned a model list this app could not read.",
				response.status,
			);
		}
		const catalog = new Map<string, CloudModelOption>();
		for (const row of parsed.data.data) {
			const parsedRow = catalogModelSchema.safeParse(row);
			if (!parsedRow.success) continue;
			const model = parsedRow.data;
			const inputs = model.architecture?.input_modalities;
			catalog.set(model.id, {
				id: model.id,
				name: modelDisplayName(
					model.id,
					model.display_name?.trim() ||
						model.displayName?.trim() ||
						model.name?.trim() ||
						model.id,
				),
				catalogId: "cline",
				...(model.description ? { description: model.description } : {}),
				tags: model.tags ?? [],
				...(inputs?.length ? { supportsImages: inputs.includes("image") } : {}),
				...(model.supported_parameters
					? {
							supportsReasoning:
								model.supported_parameters.includes("reasoning"),
						}
					: {}),
			});
		}
		const recommended = recommendations?.success ? recommendations.data : {};
		const seen = new Set<string>();
		const models: CloudModelOption[] = [];
		const featured = [
			...(recommended.clineCloud ?? []).map((model) => ({
				model,
				tier: "cloud" as const,
			})),
			...(recommended.recommended ?? []).map((model) => ({
				model,
				tier: "recommended" as const,
			})),
			...(recommended.free ?? []).map((model) => ({
				model,
				tier: "free" as const,
			})),
			...(recommended.clinePass ?? []).map((model) => ({
				model,
				tier: "subscribed" as const,
			})),
		];
		for (const { model, tier } of featured) {
			if (seen.has(model.id)) continue;
			seen.add(model.id);
			// The curated Cloud/Pass/Free IDs use a routing prefix absent from the
			// full catalog. As in the desktop featured-model join, fall back only
			// to an unambiguous exact slug; never confuse variants such as :free.
			const matches = /^(cline-cloud|cline-pass|cline-free)\//.test(model.id)
				? [...catalog.values()].filter(
						(entry) =>
							entry.id.slice(entry.id.indexOf("/") + 1) ===
							model.id.slice(model.id.indexOf("/") + 1),
					)
				: [];
			const info =
				catalog.get(model.id) ??
				(matches.length === 1 ? matches[0] : undefined);
			// Canonical capabilities beat synthetic cline-paid aliases.
			// Never turn an explicit false into true.
			const canonical = matches.filter(
				(entry) => !entry.id.startsWith("cline-paid/"),
			);
			const reasoningInfo =
				tier === "cloud" &&
				catalog.get(model.id)?.supportsReasoning !== undefined
					? catalog.get(model.id)
					: canonical.length === 1
						? canonical[0]
						: matches.length === 1
							? matches[0]
							: catalog.get(model.id);
			models.push({
				...info,
				id: model.id,
				catalogId:
					tier === "cloud"
						? "cline-cloud"
						: tier === "subscribed"
							? "cline-pass"
							: "cline",
				...(tier === "cloud" || tier === "subscribed"
					? {
							supportsReasoning: reasoningInfo
								? reasoningInfo.supportsReasoning
								: matches.length === 0
									? true
									: undefined,
						}
					: {}),
				name: modelDisplayName(model.id, model.name),
				...(model.description ? { description: model.description } : {}),
				tags: model.tags ?? [],
				tier,
			});
		}
		for (const model of catalog.values()) {
			if (!seen.has(model.id)) {
				models.push(model);
				seen.add(model.id);
			}
		}
		if (!seen.has(CLINE_DEFAULT_MODEL_ID)) {
			models.unshift({
				id: CLINE_DEFAULT_MODEL_ID,
				name: "Cline default",
				tags: ["Default"],
			});
		}
		return models;
	}

	private async fetch(path: string, authenticated: boolean): Promise<Response> {
		const headers: Record<string, string> = { Accept: "application/json" };
		if (authenticated) {
			const token = await this.options.getAccessToken();
			if (!token) {
				throw new CloudSetupApiError("Sign in to Cline first.", 401);
			}
			headers.Authorization = `Bearer ${formatCloudCredential(token)}`;
		}
		const response = await (this.options.fetchImpl ?? globalThis.fetch)(
			`${this.options.apiBaseUrl}${path}`,
			{ method: "GET", headers },
		);
		if (!response.ok) {
			throw new CloudSetupApiError(
				response.status === 404 && authenticated
					? "Connect GitHub to your Cline account, then try again."
					: `Cline setup request failed (${response.status}).`,
				response.status,
			);
		}
		return response;
	}
}
