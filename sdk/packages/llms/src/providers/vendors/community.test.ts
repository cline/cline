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
				tokenUrl: "https://auth.example/oauth/token",
				deploymentId: "deployment-id",
			},
		});

		const model = provider.model("anthropic--claude-4.6-sonnet") as {
			config?: { destination?: Record<string, unknown> };
		};

		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
		expect(model.config?.destination).toMatchObject({
			service: {
				credentials: {
					clientid: "sap-client",
					clientsecret: "sap-secret",
					serviceurls: {
						AI_API_URL: "https://api.ai.example.aws.ml.hana.ondemand.com",
					},
					url: "https://auth.example",
				},
				label: "aicore",
				name: "sapaicore",
				tags: ["aicore"],
			},
		});
	});

	it("uses resource group deployment resolution for orchestration mode", async () => {
		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example",
				resourceGroup: "default",
				useOrchestrationMode: true,
			},
		});

		const model = provider.model("anthropic--claude-4.6-sonnet") as {
			config?: {
				deploymentConfig?: Record<string, unknown>;
				providerApi?: string;
			};
		};

		expect(model.config?.deploymentConfig).toMatchObject({
			resourceGroup: "default",
		});
		expect(model.config?.deploymentConfig).not.toHaveProperty("deploymentId");
		expect(model.config?.providerApi).toBe("orchestration");
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
