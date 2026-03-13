import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect } from "chai"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "../..")

describe("generate-state-proto script", () => {
	it("preserves field numbers for map fields and hyphenated secret names", function () {
		this.timeout(10000)
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-state-proto-"))

		try {
			const stateKeysPath = path.join(tmpDir, "state-keys.ts")
			const stateProtoPath = path.join(tmpDir, "state.proto")

			fs.writeFileSync(
				stateKeysPath,
				[
					"const API_HANDLER_SETTINGS_FIELDS = {",
					"  openAiHeaders: { default: {} as Record<string, string> },",
					"} satisfies Record<string, { default: any }>",
					"",
					"const USER_SETTINGS_FIELDS = {} satisfies Record<string, { default: any }>",
					"",
					"const SECRETS_KEYS = [",
					'  "openai-codex-oauth-credentials",',
					"] as const",
				].join("\n"),
			)

			fs.writeFileSync(
				stateProtoPath,
				[
					'syntax = "proto3";',
					"package cline;",
					"",
					"message Secrets {",
					"  optional string openai_codex_oauth_credentials = 48;",
					"}",
					"",
					"message Settings {",
					"  map<string, string> open_ai_headers = 177;",
					"}",
				].join("\n"),
			)

			execFileSync(process.execPath, [path.join(repoRoot, "scripts/generate-state-proto.mjs")], {
				cwd: repoRoot,
				env: {
					...process.env,
					STATE_KEYS_PATH: stateKeysPath,
					STATE_PROTO_PATH: stateProtoPath,
				},
			})

			const output = fs.readFileSync(stateProtoPath, "utf8")
			expect(output).to.contain("optional string openai_codex_oauth_credentials = 48;")
			expect(output).to.contain("map<string, string> open_ai_headers = 177;")
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		}
	})

	it("preserves existing numbers while assigning the next available number to new fields", function () {
		this.timeout(10000)
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-state-proto-"))

		try {
			const stateKeysPath = path.join(tmpDir, "state-keys.ts")
			const stateProtoPath = path.join(tmpDir, "state.proto")

			fs.writeFileSync(
				stateKeysPath,
				[
					"const API_HANDLER_SETTINGS_FIELDS = {",
					"  openAiHeaders: { default: {} as Record<string, string> },",
					"  anthropicBaseUrl: { default: undefined as string | undefined },",
					"} satisfies Record<string, { default: any }>",
					"",
					"const USER_SETTINGS_FIELDS = {} satisfies Record<string, { default: any }>",
					"",
					"const SECRETS_KEYS = [",
					'  "openai-codex-oauth-credentials",',
					'  "apiKey",',
					"] as const",
				].join("\n"),
			)

			fs.writeFileSync(
				stateProtoPath,
				[
					'syntax = "proto3";',
					"package cline;",
					"",
					"message Secrets {",
					"  optional string openai_codex_oauth_credentials = 48;",
					"}",
					"",
					"message Settings {",
					"  map<string,string> open_ai_headers = 177;",
					"}",
				].join("\n"),
			)

			execFileSync(process.execPath, [path.join(repoRoot, "scripts/generate-state-proto.mjs")], {
				cwd: repoRoot,
				env: {
					...process.env,
					STATE_KEYS_PATH: stateKeysPath,
					STATE_PROTO_PATH: stateProtoPath,
				},
			})

			const output = fs.readFileSync(stateProtoPath, "utf8")
			expect(output).to.contain("optional string openai_codex_oauth_credentials = 48;")
			expect(output).to.contain("optional string api_key = 49;")
			expect(output).to.contain("map<string, string> open_ai_headers = 177;")
			expect(output).to.contain("optional string anthropic_base_url = 178;")
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		}
	})
})
