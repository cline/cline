import * as disk from "@core/storage/disk";
import axios from "axios";
import { expect } from "chai";
import fs from "fs/promises";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";
import { ClineEnv, Environment } from "@/config";
import { Logger } from "@/shared/services/Logger";
import {
	refreshClineRecommendedModels,
	resetClineRecommendedModelsCacheForTests,
} from "../refreshClineRecommendedModels";

const expectedClinePassModelOrder = [
	"cline-pass/glm-5.2",
	"cline-pass/deepseek-v4-pro",
	"cline-pass/deepseek-v4-flash",
	"cline-pass/kimi-k2.7-code",
	"cline-pass/kimi-k2.6",
	"cline-pass/mimo-v2.5-pro",
	"cline-pass/mimo-v2.5",
	"cline-pass/minimax-m3",
	"cline-pass/qwen3.7-max",
	"cline-pass/qwen3.7-plus",
] as const;

describe("refreshClineRecommendedModels", () => {
	let sandbox: sinon.SinonSandbox;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
		resetClineRecommendedModelsCacheForTests();
		sandbox.stub(Logger, "log");
		sandbox.stub(Logger, "error");
	});

	afterEach(() => {
		resetClineRecommendedModelsCacheForTests();
		sandbox.restore();
	});

	it("fetches from upstream", async () => {
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		});
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp");
		sandbox.stub(fs, "writeFile").resolves();
		const axiosGetStub = sandbox.stub(axios, "get").resolves({
			data: {
				recommended: [
					{
						id: "anthropic/claude-sonnet-5",
						description: "Remote recommended",
						tags: ["NEW"],
					},
				],
				free: [{ id: "z-ai/glm-5", description: "Remote free" }],
				clinePass: [
					{
						id: "cline-pass/glm-5",
						description: "Remote ClinePass",
						tags: ["CLINE_PASS"],
					},
				],
			},
		});

		const result = await refreshClineRecommendedModels();

		expect(axiosGetStub.calledOnce).to.equal(true);
		expect(result).to.deep.equal({
			recommended: [
				{
					id: "anthropic/claude-sonnet-5",
					name: "anthropic/claude-sonnet-5",
					description: "Remote recommended",
					tags: ["NEW"],
				},
			],
			free: [
				{
					id: "z-ai/glm-5",
					name: "z-ai/glm-5",
					description: "Remote free",
					tags: [],
				},
			],
			clinePass: [
				{
					id: "cline-pass/glm-5",
					name: "cline-pass/glm-5",
					description: "Remote ClinePass",
					tags: ["CLINE_PASS"],
				},
			],
		});
	});

	it("uses the in-memory cache after upstream cache is populated", async () => {
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		});
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp");
		sandbox.stub(fs, "writeFile").resolves();
		const axiosGetStub = sandbox.stub(axios, "get").resolves({
			data: {
				recommended: [
					{
						id: "google/gemini-3.1-pro-preview",
						description: "Remote recommended",
						tags: ["NEW"],
					},
				],
				free: [
					{
						id: "minimax/minimax-m2.5",
						description: "Remote free",
						tags: ["FREE"],
					},
				],
				clinePass: [
					{
						id: "cline-pass/glm-5",
						description: "Remote ClinePass",
						tags: ["CLINE_PASS"],
					},
				],
			},
		});

		const firstResult = await refreshClineRecommendedModels();
		const secondResult = await refreshClineRecommendedModels();

		expect(axiosGetStub.calledOnce).to.equal(true);
		expect(secondResult).to.deep.equal(firstResult);
	});

	it("orders ClinePass models using the curated display order", async () => {
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		});
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp");
		sandbox.stub(fs, "writeFile").resolves();
		sandbox.stub(axios, "get").resolves({
			data: {
				clinePass: [
					{ id: "cline-pass/qwen3.7-plus" },
					{ id: "cline-pass/new-model" },
					{ id: "cline-pass/deepseek-v4-flash" },
					{ id: "cline-pass/glm-5.2" },
					{ id: "cline-pass/qwen3.7-max" },
					{ id: "cline-pass/deepseek-v4-pro" },
					{ id: "cline-pass/minimax-m3" },
					{ id: "cline-pass/kimi-k2.6" },
					{ id: "cline-pass/mimo-v2.5" },
					{ id: "cline-pass/mimo-v2.5-pro" },
					{ id: "cline-pass/kimi-k2.7-code" },
				],
			},
		});

		const result = await refreshClineRecommendedModels();

		expect(result.clinePass.map((model) => model.id)).to.deep.equal([
			...expectedClinePassModelOrder,
			"cline-pass/new-model",
		]);
	});

	it("normalizes Cline provider Z.ai recommended IDs to the Cline API alias", async () => {
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		});
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp");
		sandbox.stub(fs, "writeFile").resolves();
		sandbox.stub(axios, "get").resolves({
			data: {
				recommended: [
					{
						id: "zai/glm-5.2",
						name: "zai/glm-5.2",
						description: "Recommended GLM",
					},
				],
				free: [
					{
						id: "zai/free-glm",
						description: "Free GLM",
					},
				],
			},
		});

		const result = await refreshClineRecommendedModels();

		expect(result.recommended[0]).to.include({
			id: "z-ai/glm-5.2",
			name: "z-ai/glm-5.2",
		});
		expect(result.free[0]).to.include({
			id: "z-ai/free-glm",
			name: "z-ai/free-glm",
		});
	});

	it("normalizes cached Cline provider Z.ai recommended IDs", async () => {
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		});
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp");
		sandbox.stub(axios, "get").rejects(new Error("network unavailable"));
		sandbox.stub(fs, "access").resolves();
		sandbox.stub(fs, "readFile").resolves(
			JSON.stringify({
				recommended: [
					{
						id: "zai/glm-5.2",
						name: "zai/glm-5.2",
					},
				],
			}),
		);

		const result = await refreshClineRecommendedModels();

		expect(result.recommended.map((model) => model.id)).to.deep.equal(["z-ai/glm-5.2"]);
		expect(result.recommended.map((model) => model.name)).to.deep.equal(["z-ai/glm-5.2"]);
	});

	it("prefers canonical ClinePass Z.ai IDs when aliases are also present", async () => {
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		});
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp");
		sandbox.stub(fs, "writeFile").resolves();
		sandbox.stub(axios, "get").resolves({
			data: {
				clinePass: [
					{
						id: "cline-pass/z-ai/glm-5.2",
						description: "OpenRouter alias",
					},
					{
						id: "cline-pass/zai/glm-5.2",
						description: "Canonical ID",
					},
				],
			},
		});

		const result = await refreshClineRecommendedModels();

		expect(result.clinePass.map((model) => model.id)).to.deep.equal(["cline-pass/zai/glm-5.2"]);
	});
});
