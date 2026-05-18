import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBedrockProviderModule } from "./bedrock";

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
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "bedrock",
		...overrides,
	};
}
