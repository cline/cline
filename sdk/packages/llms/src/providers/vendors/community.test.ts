import { afterEach, describe, expect, it } from "vitest";
import { createSapAiCoreProviderModule } from "./community";

const originalServiceKey = process.env.AICORE_SERVICE_KEY;

describe("createSapAiCoreProviderModule", () => {
	afterEach(() => {
		if (originalServiceKey === undefined) {
			delete process.env.AICORE_SERVICE_KEY;
		} else {
			process.env.AICORE_SERVICE_KEY = originalServiceKey;
		}
	});

	it("passes SAP credentials as a provider destination without mutating process env", async () => {
		process.env.AICORE_SERVICE_KEY = "existing-service-key";

		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example",
				deploymentId: "deployment-id",
			},
		});

		const model = provider.model("anthropic--claude-4.6-sonnet") as {
			config?: { destination?: Record<string, unknown> };
		};

		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
		expect(model.config?.destination).toMatchObject({
			authentication: "OAuth2ClientCredentials",
			clientId: "sap-client",
			clientSecret: "sap-secret",
			tokenServiceUrl: "https://auth.example/oauth/token",
			url: "https://api.ai.example.aws.ml.hana.ondemand.com",
		});
	});

	it("fails fast for partial explicit SAP configuration", async () => {
		await expect(
			createSapAiCoreProviderModule({
				providerId: "sapaicore",
				options: {
					clientId: "sap-client",
					clientSecret: "sap-secret",
					tokenUrl: "https://auth.example",
				},
			}),
		).rejects.toThrow(/baseUrl/);
	});
});
