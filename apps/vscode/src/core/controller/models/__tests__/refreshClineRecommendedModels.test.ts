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
						id: "anthropic/claude-sonnet-4.6",
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
					id: "anthropic/claude-sonnet-4.6",
					name: "anthropic/claude-sonnet-4.6",
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
});
