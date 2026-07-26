import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createAmazonBedrock: vi.fn(),
	fromNodeProviderChain: vi.fn(),
	model: vi.fn(),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
	createAmazonBedrock: mocks.createAmazonBedrock,
}));

vi.mock("@aws-sdk/credential-providers", () => ({
	fromNodeProviderChain: mocks.fromNodeProviderChain,
}));

import { createGateway, getProviderIds } from "../index";
import { createBedrockProviderModule } from "./vendors/bedrock";

describe("Bedrock-only runtime", () => {
	const originalEnvironment = {
		accessKey: process.env.AWS_ACCESS_KEY_ID,
		secretKey: process.env.AWS_SECRET_ACCESS_KEY,
		sessionToken: process.env.AWS_SESSION_TOKEN,
	};

	beforeEach(() => {
		mocks.createAmazonBedrock.mockReset();
		mocks.fromNodeProviderChain.mockReset();
		mocks.model.mockReset();
		mocks.createAmazonBedrock.mockReturnValue(mocks.model);
	});

	afterEach(() => {
		for (const [key, value] of Object.entries({
			AWS_ACCESS_KEY_ID: originalEnvironment.accessKey,
			AWS_SECRET_ACCESS_KEY: originalEnvironment.secretKey,
			AWS_SESSION_TOKEN: originalEnvironment.sessionToken,
		})) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("exposes only Bedrock", () => {
		expect(getProviderIds()).toEqual(["bedrock"]);
		expect(createGateway().listProviders().map((provider) => provider.id)).toEqual([
			"bedrock",
		]);
	});

	it("uses the default AWS chain, including an environment session token", async () => {
		process.env.AWS_ACCESS_KEY_ID = "temporary-access";
		process.env.AWS_SECRET_ACCESS_KEY = "temporary-secret";
		process.env.AWS_SESSION_TOKEN = "temporary-session";
		mocks.fromNodeProviderChain.mockImplementation(() => async () => ({
			accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
			sessionToken: process.env.AWS_SESSION_TOKEN,
		}));

		await createBedrockProviderModule({
			providerId: "bedrock",
			options: { connection: { region: "us-east-1" } },
		});

		expect(mocks.fromNodeProviderChain).toHaveBeenCalledWith({
			clientConfig: { region: "us-east-1" },
		});
		const credentialProvider = mocks.createAmazonBedrock.mock.calls[0][0]
			.credentialProvider;
		await expect(credentialProvider()).resolves.toEqual({
			accessKeyId: "temporary-access",
			secretAccessKey: "temporary-secret",
			sessionToken: "temporary-session",
		});
		expect(mocks.createAmazonBedrock.mock.calls[0][0]).not.toHaveProperty(
			"accessKeyId",
		);
	});

	it("selects a named profile without copying credentials into configuration", async () => {
		mocks.fromNodeProviderChain.mockReturnValue(async () => ({
			accessKeyId: "resolved-outside-settings",
			secretAccessKey: "resolved-outside-settings",
		}));

		await createBedrockProviderModule({
			providerId: "bedrock",
			options: {
				connection: { region: "ca-central-1", profile: "engineering-sso" },
			},
		});

		expect(mocks.fromNodeProviderChain).toHaveBeenCalledWith({
			profile: "engineering-sso",
			ignoreCache: true,
			clientConfig: { region: "ca-central-1" },
		});
		expect(JSON.stringify(mocks.createAmazonBedrock.mock.calls[0][0])).not.toContain(
			"resolved-outside-settings",
		);
	});
});
