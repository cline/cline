import { afterEach, describe, expect, it } from "vitest";
import { createSapAiCoreProviderModule } from "./community";

const originalServiceKey = process.env.AICORE_SERVICE_KEY;

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("createSapAiCoreProviderModule", () => {
	afterEach(() => {
		if (originalServiceKey === undefined) {
			delete process.env.AICORE_SERVICE_KEY;
		} else {
			process.env.AICORE_SERVICE_KEY = originalServiceKey;
		}
	});

	it("uses SAP service-key credentials without mutating process env", async () => {
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
			config?: {
				destination?: Record<string, unknown>;
				deploymentConfig?: Record<string, unknown>;
				providerApi?: string;
			};
		};

		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
		expect(model.config?.destination).toBeUndefined();
		expect(model.config?.deploymentConfig).toMatchObject({
			deploymentId: "deployment-id",
		});
		expect(model.config?.providerApi).toBe("orchestration");
	});

	it("sets SAP service-key credentials while model methods run", async () => {
		process.env.AICORE_SERVICE_KEY = "existing-service-key";

		const provider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com/",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example/oauth/token",
			},
		});

		const model = provider.model("anthropic--claude-4.6-sonnet") as {
			doGenerate: () => Promise<string>;
		};
		let observedServiceKey: string | undefined;
		model.doGenerate = async () => {
			observedServiceKey = process.env.AICORE_SERVICE_KEY;
			return "ok";
		};

		await expect(model.doGenerate()).resolves.toBe("ok");
		expect(JSON.parse(observedServiceKey ?? "{}")).toMatchObject({
			clientid: "sap-client",
			clientsecret: "sap-secret",
			serviceurls: {
				AI_API_URL: "https://api.ai.example.aws.ml.hana.ondemand.com",
			},
			url: "https://auth.example",
		});
		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
	});

	it("serializes concurrent SAP service-key model calls", async () => {
		process.env.AICORE_SERVICE_KEY = "existing-service-key";

		const firstProvider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://first.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "first-client",
				clientSecret: "first-secret",
				tokenUrl: "https://first-auth.example",
			},
		});
		const secondProvider = await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://second.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "second-client",
				clientSecret: "second-secret",
				tokenUrl: "https://second-auth.example",
			},
		});

		const firstModel = firstProvider.model("anthropic--claude-4.6-sonnet") as {
			doGenerate: () => Promise<string>;
		};
		const secondModel = secondProvider.model("anthropic--claude-4.6-sonnet") as {
			doGenerate: () => Promise<string>;
		};
		const firstStarted = deferred();
		const releaseFirst = deferred();
		let firstServiceKey: string | undefined;
		let firstServiceKeyBeforeReturn: string | undefined;
		let secondServiceKey: string | undefined;
		let secondStarted = false;

		firstModel.doGenerate = async () => {
			firstServiceKey = process.env.AICORE_SERVICE_KEY;
			firstStarted.resolve();
			await releaseFirst.promise;
			firstServiceKeyBeforeReturn = process.env.AICORE_SERVICE_KEY;
			return "first";
		};
		secondModel.doGenerate = async () => {
			secondStarted = true;
			secondServiceKey = process.env.AICORE_SERVICE_KEY;
			return "second";
		};

		const firstResult = firstModel.doGenerate();
		await firstStarted.promise;
		const secondResult = secondModel.doGenerate();
		await Promise.resolve();
		await Promise.resolve();

		expect(secondStarted).toBe(false);
		expect(JSON.parse(firstServiceKey ?? "{}")).toMatchObject({
			clientid: "first-client",
		});

		releaseFirst.resolve();
		await expect(firstResult).resolves.toBe("first");
		await expect(secondResult).resolves.toBe("second");

		expect(JSON.parse(firstServiceKeyBeforeReturn ?? "{}")).toMatchObject({
			clientid: "first-client",
		});
		expect(JSON.parse(secondServiceKey ?? "{}")).toMatchObject({
			clientid: "second-client",
		});
		expect(process.env.AICORE_SERVICE_KEY).toBe("existing-service-key");
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
