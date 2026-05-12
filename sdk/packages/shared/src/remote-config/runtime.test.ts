import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildRemoteConfigSessionBlobUploadMetadata,
	prepareRemoteConfigRuntime,
	REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY,
	readRemoteConfigSessionBlobUploadMetadata,
} from "./index";

async function createTempWorkspace(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "sdk-remote-config-"));
}

describe("remote-config runtime", () => {
	it("materializes remote-config rules and workflows", async () => {
		const workspacePath = await createTempWorkspace();

		const prepared = await prepareRemoteConfigRuntime({
			workspacePath,
			pluginName: "enterprise",
			controlPlane: {
				name: "test",
				async fetchBundle() {
					return {
						source: "test",
						version: "1",
						remoteConfig: {
							version: "v1",
							globalRules: [
								{
									name: "managed-rule",
									contents: "Follow managed policy.",
									alwaysEnabled: true,
								},
							],
							globalWorkflows: [
								{
									name: "Managed Workflow.md",
									contents: "Run the managed workflow.",
									alwaysEnabled: true,
								},
							],
						},
					};
				},
			},
		});

		await expect(
			fs.readFile(prepared.paths.rulesFilePath, "utf8"),
		).resolves.toContain("Follow managed policy.");
		await expect(
			fs.readFile(
				path.join(prepared.paths.workflowsPath, "managed-workflow.md"),
				"utf8",
			),
		).resolves.toBe("Run the managed workflow.");
		expect(prepared.pluginDefinition.name).toBe("enterprise");
		expect(prepared.workflowsDirectories).toEqual([
			prepared.paths.workflowsPath,
		]);
	});

	it("builds and reads non-secret blob upload metadata", () => {
		const metadata = buildRemoteConfigSessionBlobUploadMetadata({
			version: "v1",
			enterpriseTelemetry: {
				promptUploading: {
					enabled: true,
					type: "s3_access_keys",
					s3AccessSettings: {
						bucket: "cline-prompts",
						accessKeyId: "key",
						secretAccessKey: "secret",
						region: "us-west-2",
					},
				},
			},
		});

		expect(metadata).toEqual({
			version: 1,
			storage: {
				adapterType: "s3",
				bucket: "cline-prompts",
				region: "us-west-2",
				endpoint: undefined,
				accountId: undefined,
			},
			userDistinctId: undefined,
		});
		expect(
			readRemoteConfigSessionBlobUploadMetadata({
				metadata: {
					[REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY]: metadata,
				},
			}),
		).toEqual(metadata);
	});
});
