import { ProviderSettingsManager } from "../provider-settings-manager";

const [filePath, iterationsValue] = process.argv.slice(2);
if (!filePath || !iterationsValue) {
	throw new Error("Expected providers.json path and iteration count");
}

const iterations = Number.parseInt(iterationsValue, 10);
if (!Number.isInteger(iterations) || iterations <= 0) {
	throw new Error("Expected a positive iteration count");
}

const manager = new ProviderSettingsManager({ filePath });
const padding = "x".repeat(512 * 1024);
for (let iteration = 0; iteration < iterations; iteration += 1) {
	manager.saveProviderSettings({
		provider: "anthropic",
		model: `model-${iteration}`,
		apiKey: `${iteration}-${padding}`,
	});
}
