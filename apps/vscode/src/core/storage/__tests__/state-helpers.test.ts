import fs from "fs/promises"
import { describe, it, beforeEach, afterEach } from "mocha"
import os from "os"
import path from "path"
import should from "should"
import { ClineFileStorage } from "@/shared/storage/ClineFileStorage"
import { migrateStaleNativeToolCallSetting } from "../utils/state-helpers"

describe("migrateStaleNativeToolCallSetting", () => {
	let tempDir: string
	let store: ClineFileStorage

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `state-helpers-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		store = new ClineFileStorage(path.join(tempDir, "globalState.json"), "GlobalState")
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("resets a stale persisted false to true and sets the migration marker", async () => {
		await store.update("nativeToolCallEnabled", false)

		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.true()
		store.get("nativeToolCallEnabledDefaultMigrated")!.should.be.true()
	})

	it("leaves a false value intact once the migration marker is set (deliberate opt-out)", async () => {
		await store.update("nativeToolCallEnabled", false)
		await store.update("nativeToolCallEnabledDefaultMigrated", true)

		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.false()
	})

	it("does not create a value when none is persisted, but still sets the marker", async () => {
		await migrateStaleNativeToolCallSetting(store)

		should(store.get("nativeToolCallEnabled")).be.undefined()
		store.get("nativeToolCallEnabledDefaultMigrated")!.should.be.true()
	})

	it("leaves an explicit true untouched", async () => {
		await store.update("nativeToolCallEnabled", true)

		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.true()
	})

	it("is a no-op on the second run after a user opts back out", async () => {
		await store.update("nativeToolCallEnabled", false)
		await migrateStaleNativeToolCallSetting(store)

		// User deliberately turns the setting off again
		await store.update("nativeToolCallEnabled", false)
		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.false()
	})

	it("skips OpenAI-Compatible users without setting the marker", async () => {
		await store.update("nativeToolCallEnabled", false)
		await store.update("actModeApiProvider", "openai")

		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.false()
		should(store.get("nativeToolCallEnabledDefaultMigrated")).be.undefined()
	})

	it("skips when only the plan-mode provider is OpenAI-Compatible", async () => {
		await store.update("nativeToolCallEnabled", false)
		await store.update("planModeApiProvider", "openai")
		await store.update("actModeApiProvider", "openrouter")

		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.false()
	})

	it("migrates a previously skipped user after they switch away from OpenAI-Compatible", async () => {
		await store.update("nativeToolCallEnabled", false)
		await store.update("actModeApiProvider", "openai")
		await migrateStaleNativeToolCallSetting(store)

		await store.update("actModeApiProvider", "openrouter")
		await migrateStaleNativeToolCallSetting(store)

		store.get("nativeToolCallEnabled")!.should.be.true()
		store.get("nativeToolCallEnabledDefaultMigrated")!.should.be.true()
	})
})
