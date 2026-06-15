import "should";
import {
	huggingFaceDefaultModelId,
	huggingFaceModels,
} from "../../../../shared/api";
import { HuggingFaceHandler } from "../huggingface";

describe("HuggingFaceHandler", () => {
	it("uses dynamic Hugging Face model info for models outside the static list", () => {
		const modelInfo = {
			maxTokens: 8192,
			contextWindow: 128_000,
			supportsImages: false,
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
			description: "Available on providers: test-provider",
		};

		const handler = new HuggingFaceHandler({
			huggingFaceApiKey: "test-api-key",
			huggingFaceModelId: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
			huggingFaceModelInfo: modelInfo,
		});

		handler.getModel().should.deepEqual({
			id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
			info: modelInfo,
		});
	});

	it("preserves unknown model IDs when model info is unavailable", () => {
		const handler = new HuggingFaceHandler({
			huggingFaceApiKey: "test-api-key",
			huggingFaceModelId: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
		});

		handler.getModel().should.deepEqual({
			id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
			info: huggingFaceModels[huggingFaceDefaultModelId],
		});
	});
});
