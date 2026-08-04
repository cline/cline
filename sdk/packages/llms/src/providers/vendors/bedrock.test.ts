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

		module.model("anthropic.claude-sonnet-4-6");

		expect(bedrockModelMock).toHaveBeenCalledWith(
			"us.anthropic.claude-sonnet-4-6",
		);
	});

	it("derives the geo prefix from AWS_REGION when no region is configured", async () => {
		process.env.AWS_REGION = "eu-west-1";

		const module = await createBedrockProviderModule(
			config({ apiKey: "bedrock-api-key" }),
		);

		module.model("anthropic.claude-sonnet-4-6");

		expect(bedrockModelMock).toHaveBeenCalledWith(
			"eu.anthropic.claude-sonnet-4-6",
		);
	});

	it("passes already-prefixed inference-profile ids through unmodified", async () => {
		const module = await createBedrockProviderModule(
			config({
				apiKey: "bedrock-api-key",
				options: { region: "us-east-1", useCrossRegionInference: true },
			}),
		);

		module.model("global.anthropic.claude-sonnet-4-6");

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
				region: "us-gov-west-1",
			}),
		).toBe("us-gov.anthropic.claude-sonnet-5");
	});

	it("prefixes other profile-only foundation models", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-3-7-sonnet-20250219-v1:0", {
				region: "us-east-1",
			}),
		).toBe("us.anthropic.claude-3-7-sonnet-20250219-v1:0");
		expect(
			resolveBedrockModelId("amazon.nova-pro-v1:0", { region: "us-east-1" }),
		).toBe("us.amazon.nova-pro-v1:0");
		expect(
			resolveBedrockModelId("deepseek.r1-v1:0", { region: "us-west-2" }),
		).toBe("us.deepseek.r1-v1:0");
		expect(
			resolveBedrockModelId("meta.llama4-maverick-17b-instruct-v1:0", {
				region: "us-east-1",
			}),
		).toBe("us.meta.llama4-maverick-17b-instruct-v1:0");
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

	it("never rewrites custom-model configurations", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-6", {
				region: "us-east-1",
				useCrossRegionInference: true,
				customModelBaseId: "anthropic.claude-sonnet-4-6",
			}),
		).toBe("anthropic.claude-sonnet-4-6");
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

	it("leaves on-demand-capable models untouched unless cross-region inference is enabled", () => {
		expect(
			resolveBedrockModelId("anthropic.claude-3-5-sonnet-20241022-v2:0", {
				region: "us-east-1",
			}),
		).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
		expect(
			resolveBedrockModelId("anthropic.claude-3-5-sonnet-20241022-v2:0", {
				region: "us-east-1",
				useCrossRegionInference: true,
			}),
		).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0");
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
			resolveBedrockModelId("anthropic.claude-3-5-sonnet-20241022-v2:0", {
				region: "us-east-1",
				useCrossRegionInference: true,
				useGlobalInference: true,
			}),
		).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0");
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
		// Other Asia-Pacific regions use the apac. geo profile.
		expect(
			resolveBedrockModelId("anthropic.claude-sonnet-4-20250514-v1:0", {
				region: "ap-southeast-1",
			}),
		).toBe("apac.anthropic.claude-sonnet-4-20250514-v1:0");
		// Models without a country profile fall back to apac. in those regions.
		expect(
			resolveBedrockModelId("anthropic.claude-3-5-sonnet-20241022-v2:0", {
				region: "ap-northeast-1",
				useCrossRegionInference: true,
			}),
		).toBe("apac.anthropic.claude-3-5-sonnet-20241022-v2:0");
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
