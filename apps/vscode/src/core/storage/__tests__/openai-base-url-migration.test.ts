import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createStorageContext, type StorageContext } from "@/shared/storage/storage-context"
import { migrateOpenAiCompatibleBaseUrlToV1 } from "../openai-base-url-migration"

describe("migrateOpenAiCompatibleBaseUrlToV1", () => {
	let tempDir: string
	let storage: StorageContext

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openai-base-url-migration-"))
		storage = createStorageContext({ clineDir: tempDir, workspacePath: tempDir })
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	for (const [baseUrl, expected] of [
		["https://example.com", "https://example.com/v1"],
		["http://localhost:8000/", "http://localhost:8000/v1"],
	]) {
		it(`adds /v1 to the host-only base URL ${baseUrl}`, () => {
			storage.globalState.update("openAiBaseUrl", baseUrl)

			migrateOpenAiCompatibleBaseUrlToV1(storage)

			expect(storage.globalState.get<string>("openAiBaseUrl")).toBe(expected)
		})
	}

	for (const baseUrl of ["https://example.com/v1", "https://example.com/api/foo", "not a url"]) {
		it(`leaves the base URL ${baseUrl} unchanged`, () => {
			storage.globalState.update("openAiBaseUrl", baseUrl)

			migrateOpenAiCompatibleBaseUrlToV1(storage)

			expect(storage.globalState.get<string>("openAiBaseUrl")).toBe(baseUrl)
		})
	}

	it("runs only once, so a host-only URL saved afterwards stays as entered", () => {
		storage.globalState.update("openAiBaseUrl", "https://example.com")
		migrateOpenAiCompatibleBaseUrlToV1(storage)
		storage.globalState.update("openAiBaseUrl", "https://example.com")

		migrateOpenAiCompatibleBaseUrlToV1(storage)

		expect(storage.globalState.get<string>("openAiBaseUrl")).toBe("https://example.com")
	})

	it("marks itself done when there is no base URL, so a later host-only URL stays as entered", () => {
		migrateOpenAiCompatibleBaseUrlToV1(storage)
		storage.globalState.update("openAiBaseUrl", "https://example.com")

		migrateOpenAiCompatibleBaseUrlToV1(storage)

		expect(storage.globalState.get<string>("openAiBaseUrl")).toBe("https://example.com")
	})

	it("shares its marker across hosts through globalState.json", () => {
		storage.globalState.update("openAiBaseUrl", "https://example.com")
		migrateOpenAiCompatibleBaseUrlToV1(storage)
		storage.globalState.update("openAiBaseUrl", "https://example.com")

		const otherHost = createStorageContext({ clineDir: tempDir, workspacePath: tempDir })
		migrateOpenAiCompatibleBaseUrlToV1(otherHost)

		expect(otherHost.globalState.get<string>("openAiBaseUrl")).toBe("https://example.com")
	})
})
