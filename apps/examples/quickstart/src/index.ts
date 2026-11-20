import { Agent, Llms } from "@cline/sdk";

const agent = new Agent({
	providerId: "cline",
	modelId: Llms.CLINE_DEFAULT_MODEL_ID,
	apiKey: process.env.CLINE_API_KEY,
	maxIterations: 1,
});

agent.subscribe((event) => {
	if (event.type === "assistant-text-delta") {
		process.stdout.write(event.text);
	}
});

const result = await agent.run("Explain what an SDK is in two sentences.");
console.log(
	`\n\nDone (${result.iterations} iteration, ${result.usage.outputTokens} output tokens)`,
);
