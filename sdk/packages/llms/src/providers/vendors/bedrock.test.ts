import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBedrockProviderModule, resolveBedrockModelId } from "./bedrock";

const createAmazonBedrockMock = vi.hoisted(() => vi.fn());
const fromNodeProviderChainMock = vi.hoisted(() => vi.fn());
const bedrockModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ modelId })),
);

vi.mock("@ai-sdk/amazon-bedrock", () => ({
	createAmazonBedrock: createAmazonBedrockMock,
}));

vi.mock("@aws-sdk/credential-providers", () => ({
	fromNodeProviderChain: fromNodeProviderChainMock,
}));

const ORIGINAL_ENV = { ...process.env };

describe("createBedrockProviderModule", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		createAmazonBedrockMock.mockReset();
		createAmazonBedrockMock.mockReturnValue(bedrockModelMock);
		fromNodeProviderChainMock.mockReset();
		fromNodeProviderChainMock.mockReturnValue(async () => ({
			accessKeyId: "chain-access-key",
			secretAccessKey: "chain-secret-key",
		}));
		bedrockModelMock.mockClear();
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("uses explicit Bedrock bearer API keys without configuring SigV4 credentials", async () => {
		await createBedrockProviderModule(
			config({
				apiKey: " bedrock-api-key ",
				options: { region: "us-east-1" },
			}),
		);

		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "bedrock-api-key",
				region: "us-east-1",
				accessKeyId: undefined,
				secretAccessKey: undefined,
				sessionToken: undefined,
				credentialProvider: undefined,
			}),
		);
		expect(fromNodeProviderChainMock).not.toHaveBeenCalled();
	});

	it("suppresses provider credential fallback for explicit API-key auth with no resolved key", async () => {
		await createBedrockProviderModule(
			config({
				options: { authentication: "apikey", region: "us-east-1" },
			}),
		);

		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "",
				accessKeyId: undefined,
				secretAccessKey: undefined,
				sessionToken: undefined,
				credentialProvider: undefined,
			}),
		);
		expect(fromNodeProviderChainMock).not.toHaveBeenCalled();
	});

	it("uses direct IAM credentials and disables bearer-token env fallback", async () => {
		process.env.AWS_BEARER_TOKEN_BEDROCK = "env-bearer-token";

		await createBedrockProviderModule(
			config({
				options: {
					authentication: "iam",
					region: "us-west-2",
					accessKeyId: "access-key",
					secretAccessKey: "secret-key",
					sessionToken: "session-token",
				},
			}),
		);

		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "",
				accessKeyId: "access-key",
				secretAccessKey: "secret-key",
				sessionToken: "session-token",
				credentialProvider: undefined,
			}),
		);
		expect(fromNodeProviderChainMock).not.toHaveBeenCalled();
	});

	it("uses AWS profiles through the SDK credential provider chain", async () => {
		await createBedrockProviderModule(
			config({
				options: {
					authentication: "profile",
					profile: "dev-profile",
					region: "us-east-2",
				},
			}),
		);

		expect(fromNodeProviderChainMock).toHaveBeenCalledWith({
			ignoreCache: true,
			profile: "dev-profile",
			clientConfig: { region: "us-east-2" },
		});
		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "",
				accessKeyId: undefined,
				secretAccessKey: undefined,
				sessionToken: undefined,
				credentialProvider: expect.any(Function),
			}),
		);
	});

	it("treats a configured AWS profile as profile auth when authentication is omitted", async () => {
		await createBedrockProviderModule(
			config({
				options: {
					profile: "default",
					region: "us-east-1",
				},
			}),
		);

		expect(fromNodeProviderChainMock).toHaveBeenCalledWith({
			ignoreCache: true,
			profile: "default",
			clientConfig: { region: "us-east-1" },
		});
		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "",
				credentialProvider: expect.any(Function),
			}),
		);
	});

	it("uses the default AWS SDK credential chain when no static credentials are configured", async () => {
		await createBedrockProviderModule(
			config({
				options: { authentication: "iam", region: "us-east-1" },
			}),
		);

		expect(fromNodeProviderChainMock).toHaveBeenCalledWith({
			clientConfig: { region: "us-east-1" },
		});
		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "",
				credentialProvider: expect.any(Function),
			}),
		);
	});

	it("does not treat AWS_REGION or IAM env vars as bearer API keys", async () => {
		process.env.AWS_REGION = "us-west-2";
		process.env.AWS_ACCESS_KEY_ID = "env-access-key";
		process.env.AWS_SECRET_ACCESS_KEY = "env-secret-key";

		await createBedrockProviderModule(
			config({
				apiKeyEnv: ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
				options: { authentication: "iam" },
			}),
		);

		expect(createAmazonBedrockMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "",
				credentialProvider: expect.any(Function),
			}),
		);
	});

	it("routes bare modern model ids through the region's geo inference profile", async () => {
		const module = await createBedrockProviderModule(
			config({
				apiKey: "bedrock-api-key",
				options: { region: "us-east-1" },
			}),
		);

		module.operations.language("anthropic.claude-sonnet-4-6");

		expect(bedrockModelMock).toHaveBeenCalledWith(
			"us.anthropic.claude-sonnet-4-6",
		);
	});

	it("derives the geo prefix from AWS_REGION when no region is configured", async () => {
		process.env.AWS_REGION = "eu-west-1";

		const module = await createBedrockProviderModule(
			config({ apiKey: "bedrock-api-key" }),
		);

		module.operations.language("anthropic.claude-sonnet-4-6");

		expect(bedrockModelMock).toHaveBeenCalledWith(
			"eu.anthropic.claude-sonnet-4-6",
		);
	});

	it("still prefixes catalog models when a stale customModelBaseId is configured", async () => {
		// Legacy migration copies awsBedrockCustomModelBaseId without the
		// custom-selected flag, so a retained base id must not disable
		// inference-profile routing for a normal catalog model.
		const module = await createBedrockProviderModule(
			config({
				apiKey: "bedrock-api-key",
				options: {
					region: "us-east-1",
					customModelBaseId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				},
			}),
		);

		module.operations.language("anthropic.claude-sonnet-4-6");

		expect(bedrockModelMock).toHaveBeenCalledWith(
			"us.anthropic.claude-sonnet-4-6",
		);
	});

	it("passes already-prefixed inference-profile ids through unmodified", async () => {
		const module = await createBedrockProviderModule(
			config({
				apiKey: "bedrock-api-key",
				options: { region: "us-east-1", useCrossRegionInference: true },
			}),
		);

		module.operations.language("global.anthropic.claude-sonnet-4-6");

		expect(bedrockModelMock).toHaveBeenCalledWith(
			"global.anthropic.claude-sonnet-4-6",
		);
	});
});

describe("resolveBedrockModelId", () => {
	it("prefixes bare modern Claude ids with the region geo profile", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "us-east-1",
			}),
		).toBe("us.anthropic.claude-sonnet-4-6");
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-5-20250929-v1:0", {
				region: "eu-central-1",
			}),
		).toBe("eu.anthropic.claude-sonnet-4-5-20250929-v1:0");
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-5", {
				region: "us-east-1",
			}),
		).toBe("us.anthropic.claude-sonnet-5");
		expect(
			resolveBedrockModelId("anthropic.claude-fable-5", {
				region: "us-east-1",
			}),
		).toBe("us.anthropic.claude-fable-5");
	});

	it("prefixes other profile-only foundation models with confirmed variants", () => {
		expect(
			resolveBedrockModelId("deepseek.r1-v1:0", { region: "us-west-2" }),
		).toBe("us.deepseek.r1-v1:0");
		expect(
			resolveBedrockModelId("meta.llama4-maverick-17b-instruct-v1:0", {
				region: "us-east-1",
			}),
		).toBe("us.meta.llama4-maverick-17b-instruct-v1:0");
	});

	it("covers future tier-first Claude ids once the catalog carries their variants", () => {
		// Tier-first naming is matched generically, so a future tier needs no
		// pattern-list update — only the regenerated catalog entry.
		const hasCatalogModel = (id: string) =>
			id === "us.anthropic.claude-newtier-6";
		expect(
			resolveBedrockModelId("anthropic.claude-newtier-6", {
				region: "us-east-1",
				hasCatalogModel,
			}),
		).toBe("us.anthropic.claude-newtier-6");
	});

	it("preserves the raw id when no catalog variant confirms the geo profile", () => {
		// Pattern-matched profile-only models without a catalog-confirmed
		// geographic variant are never prefixed on assumption: AWS documents
		// profile availability per model and geography, so an unconfirmed id
		// (e.g. eu.amazon.nova-lite-v1:0 or us-gov.anthropic.claude-sonnet-5)
		// may not exist.
		const cases: Array<[string, string | undefined]> = [
			["amazon.nova-lite-v1:0", "eu-central-1"],
			["amazon.nova-pro-v1:0", "us-east-1"],
			["amazon.nova-2-lite-v1:0", "us-east-1"],
			["anthropic.claude-3-7-sonnet-20250219-v1:0", "us-east-1"],
			["anthropic.claude-sonnet-5", "us-gov-west-1"],
			["anthropic.claude-newtier-6", "us-east-1"],
		];
		for (const [modelId, region] of cases) {
			expect(resolveBedrockModelId(modelId, { region })).toBe(modelId);
			expect(
				resolveBedrockModelId(modelId, {
					region,
					useCrossRegionInference: true,
				}),
			).toBe(modelId);
		}
	});

	it("uses a catalog-confirmed us-gov. variant in GovCloud regions", () => {
		const hasCatalogModel = (id: string) =>
			id === "us-gov.anthropic.claude-sonnet-5";
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-5", {
				region: "us-gov-west-1",
				hasCatalogModel,
			}),
		).toBe("us-gov.anthropic.claude-sonnet-5");
	});

	it("never rewrites ids that are already profile-prefixed", () => {
		for (const modelId of [
			"us.anthropic.claude-sonnet-4-6",
			"eu.anthropic.claude-sonnet-5",
			"apac.anthropic.claude-sonnet-4-20250514-v1:0",
			"jp.anthropic.claude-sonnet-4-6",
			"global.anthropic.claude-opus-5",
		]) {
			expect(
				resolveBedrockModelId(modelId, {
					region: "us-east-1",
					useCrossRegionInference: true,
				}),
			).toBe(modelId);
		}
	});

	it("never rewrites ARNs", () => {
		const provisionedArn =
			"arn:aws:bedrock:us-east-1:123456789012:provisioned-model/abc123";
		const profileArn =
			"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/xyz";
		expect(
			resolveBedrockModelId(provisionedArn, {
				region: "us-east-1",
				useCrossRegionInference: true,
			}),
		).toBe(provisionedArn);
		expect(resolveBedrockModelId(profileArn, { region: "us-east-1" })).toBe(
			profileArn,
		);
	});

	it("keeps custom/provisioned model ids raw on the cross-region path", () => {
		// Not a catalog model and not a known profile-only family: no profile
		// variant can be confirmed, so the id is preserved even with the
		// cross-region setting enabled.
		expect(
			resolveBedrockModelId("my-provisioned-model", {
				region: "us-east-1",
				useCrossRegionInference: true,
			}),
		).toBe("my-provisioned-model");
	});

	it("falls back to the raw id for regions without a geo profile mapping", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "ca-central-1",
			}),
		).toBe("anthropic.claude-sonnet-4-6");
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				useCrossRegionInference: true,
			}),
		).toBe("anthropic.claude-sonnet-4-6");
	});

	it("leaves on-demand-capable models untouched", () => {
		for (const modelId of [
			"anthropic.claude-3-5-sonnet-20241022-v2:0",
			"anthropic.claude-v2:1",
			"anthropic.claude-instant-v1",
			"amazon.nova-canvas-v1:0",
			"amazon.titan-text-express-v1",
		]) {
			expect(resolveBedrockModelId(modelId, { region: "us-east-1" })).toBe(
				modelId,
			);
		}
	});

	it("applies cross-region inference only to catalog-confirmed profile variants", () => {
		const hasCatalogModel = (id: string) => id === "us.vendor.on-demand-model";
		// Confirmed variant: the setting routes through the geo profile.
		expect(
			resolveBedrockModelId("vendor.on-demand-model", {
				region: "us-east-1",
				useCrossRegionInference: true,
				hasCatalogModel,
			}),
		).toBe("us.vendor.on-demand-model");
		// Without the setting the id stays raw.
		expect(
			resolveBedrockModelId("vendor.on-demand-model", {
				region: "us-east-1",
				hasCatalogModel,
			}),
		).toBe("vendor.on-demand-model");
		// No confirmed variant: never manufacture a profile id for a model that
		// works on-demand.
		expect(
			resolveBedrockModelId("vendor.on-demand-model", {
				region: "eu-west-1",
				useCrossRegionInference: true,
				hasCatalogModel,
			}),
		).toBe("vendor.on-demand-model");
	});

	it("uses the global profile when both inference settings are enabled and the variant exists", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "us-east-1",
				useCrossRegionInference: true,
				useGlobalInference: true,
			}),
		).toBe("global.anthropic.claude-sonnet-4-6");
		// Global inference requires cross-region inference, mirroring legacy.
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "us-east-1",
				useGlobalInference: true,
			}),
		).toBe("us.anthropic.claude-sonnet-4-6");
		// Models without a known global variant degrade to the geo profile.
		expect(
			resolveBedrockModelId("deepseek.r1-v1:0", {
				region: "us-west-2",
				useCrossRegionInference: true,
				useGlobalInference: true,
			}),
		).toBe("us.deepseek.r1-v1:0");
	});

	it("prefers country profiles over apac. where AWS ships them", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "ap-northeast-1",
			}),
		).toBe("jp.anthropic.claude-sonnet-4-6");
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "ap-southeast-2",
			}),
		).toBe("au.anthropic.claude-sonnet-4-6");
	});

	it("uses apac. only when the catalog confirms the variant exists", () => {
		const hasCatalogModel = (id: string) =>
			["apac.anthropic.claude-sonnet-4-20250514-v1:0"].includes(id);
		// Confirmed apac variant in an Asia-Pacific region.
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-20250514-v1:0", {
				region: "ap-southeast-1",
				hasCatalogModel,
			}),
		).toBe("apac.anthropic.claude-sonnet-4-20250514-v1:0");
		// Country regions degrade to a confirmed apac variant when no jp./au.
		// variant exists.
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-20250514-v1:0", {
				region: "ap-northeast-1",
				hasCatalogModel,
			}),
		).toBe("apac.anthropic.claude-sonnet-4-20250514-v1:0");
		// No confirmed variant: keep the raw id instead of manufacturing an
		// apac. id that AWS would reject as an invalid model identifier.
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "ap-southeast-1",
			}),
		).toBe("anthropic.claude-sonnet-4-6");
	});

	it("resolves the expected wire id per region for a modern Claude model", () => {
		const cases: Array<[string | undefined, string]> = [
			["us-east-1", "us.anthropic.claude-sonnet-4-6"],
			["us-west-2", "us.anthropic.claude-sonnet-4-6"],
			// No catalog-confirmed us-gov. variant: raw id preserved.
			["us-gov-west-1", "anthropic.claude-sonnet-4-6"],
			["eu-central-1", "eu.anthropic.claude-sonnet-4-6"],
			["eu-west-3", "eu.anthropic.claude-sonnet-4-6"],
			["ap-northeast-1", "jp.anthropic.claude-sonnet-4-6"],
			["ap-northeast-3", "jp.anthropic.claude-sonnet-4-6"],
			["ap-southeast-2", "au.anthropic.claude-sonnet-4-6"],
			["ap-southeast-4", "au.anthropic.claude-sonnet-4-6"],
			// No catalog-confirmed apac./geo variant: raw id preserved.
			["ap-southeast-1", "anthropic.claude-sonnet-4-6"],
			["ap-northeast-2", "anthropic.claude-sonnet-4-6"],
			["ca-central-1", "anthropic.claude-sonnet-4-6"],
			["sa-east-1", "anthropic.claude-sonnet-4-6"],
			["me-central-1", "anthropic.claude-sonnet-4-6"],
			[undefined, "anthropic.claude-sonnet-4-6"],
		];
		for (const [region, expected] of cases) {
			expect(
				resolveBedrockModelId("anthropic.claude-sonnet-4-6", { region }),
			).toBe(expected);
		}
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "bedrock",
		...overrides,
	};
}
