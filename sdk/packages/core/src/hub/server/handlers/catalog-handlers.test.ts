/**
 * `catalog.list` went from dead command to handler here; these tests pin the
 * contract a remote model picker depends on: the catalog reaches the wire when
 * the host serves one, and a host that cannot serve one produces a refusal the
 * client can show — not a hang, not an empty catalog that reads as "no models".
 */

import type { HubCommandEnvelope, ProviderListItem } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildHubModelCatalog } from "../../../runtime/host/model-catalog";
import type { HubTransportContext } from "./context";
import { handleCatalogList } from "./catalog-handlers";

function envelope(): HubCommandEnvelope {
	return {
		version: "v1",
		command: "catalog.list",
		requestId: "hubreq_catalog_1",
		clientId: "phone-1",
	} as HubCommandEnvelope;
}

function contextWith(host: Record<string, unknown>): HubTransportContext {
	return { sessionHost: host } as unknown as HubTransportContext;
}

function provider(overrides: Partial<ProviderListItem> = {}): ProviderListItem {
	return {
		id: "anthropic",
		name: "Anthropic",
		models: 2,
		color: "#000",
		letter: "A",
		enabled: true,
		authDescription: "",
		baseUrlDescription: "",
		modelList: [
			{ id: "claude-opus-5", name: "Claude Opus 5", supportsReasoning: true },
			{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
		],
		defaultModelId: "claude-opus-5",
		...overrides,
	};
}

describe("handleCatalogList", () => {
	it("serves the host's catalog", async () => {
		const catalog = buildHubModelCatalog([provider()]);
		const reply = await handleCatalogList(
			contextWith({ listModelCatalog: async () => catalog }),
			envelope(),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload).toEqual(catalog);
	});

	it("refuses in words when the host has no catalog service", async () => {
		const reply = await handleCatalogList(contextWith({}), envelope());
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("catalog_unavailable");
	});
});

describe("buildHubModelCatalog", () => {
	it("projects providers and models into the wire shape", () => {
		const catalog = buildHubModelCatalog([provider()]);
		expect(catalog.providers).toEqual([
			{
				id: "anthropic",
				name: "Anthropic",
				enabled: true,
				defaultModelId: "claude-opus-5",
			},
		]);
		expect(catalog.modelsByProvider.anthropic).toEqual([
			{ id: "claude-opus-5", name: "Claude Opus 5", supportsThinking: true },
			{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
		]);
	});

	it("keeps a disabled provider and one with no models", () => {
		const catalog = buildHubModelCatalog([
			provider({
				id: "openai",
				name: "OpenAI",
				enabled: false,
				modelList: undefined,
				defaultModelId: undefined,
			}),
		]);
		expect(catalog.providers).toEqual([
			{ id: "openai", name: "OpenAI", enabled: false },
		]);
		// Present-but-empty, so "no models registered" is distinguishable from
		// "provider missing from the catalog".
		expect(catalog.modelsByProvider.openai).toEqual([]);
	});
});
