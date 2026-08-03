import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	computeSettingsImport,
	computeSettingsOverride,
	SETTINGS_SCHEMA_MAP,
	type SettingsBridgeDeps,
	type SettingsBridgeWriter,
	VscodeSettingsBridge,
} from "./vscode-settings-bridge"

function loadPackageJson(): {
	contributes: { configuration: { properties: Record<string, { enum?: string[]; type?: string }> } }
} {
	// Walk up from the cwd until we find the extension package.json (robust
	// regardless of how vitest resolves import.meta.url / __dirname).
	let dir = process.cwd()
	for (let depth = 0; depth < 8; depth++) {
		const candidate = join(dir, "package.json")
		try {
			const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
				contributes?: { configuration?: { properties?: Record<string, { enum?: string[]; type?: string }> } }
			}
			if (pkg.contributes?.configuration?.properties) {
				return pkg as never
			}
		} catch {
			// Not a JSON file or no schema — keep walking up.
		}
		dir = dirname(dir)
	}
	throw new Error("Could not locate package.json with contributes.configuration")
}

function makeDeps(settingsJson: Record<string, unknown> = {}): SettingsBridgeDeps & {
	emit(e: { affectsConfiguration(section: string): boolean }): void
} {
	const listeners: Array<(e: { affectsConfiguration(section: string): boolean }) => void> = []
	return {
		readSettingsJson: () => ({ ...settingsJson }),
		onDidChangeConfiguration: (listener) => {
			listeners.push(listener)
			return {
				dispose: () => {
					const index = listeners.indexOf(listener)
					if (index >= 0) {
						listeners.splice(index, 1)
					}
				},
			}
		},
		emit: (e) => {
			for (const listener of listeners) {
				listener(e)
			}
		},
	}
}

function makeWriter(initial: Record<string, unknown> = {}): SettingsBridgeWriter & {
	store: Record<string, unknown>
	writes: string[]
} {
	const store = { ...initial }
	const writes: string[] = []
	return {
		store,
		writes,
		readState: (key) => store[key],
		writeState: (key, value) => {
			store[key] = value
			writes.push(key)
		},
	}
}

describe("computeSettingsImport (initial import)", () => {
	it("imports settings.json values only when StateManager has no value", () => {
		const plan = computeSettingsImport(
			{ language: "中文", maxConsecutiveMistakes: 5, subagentsEnabled: true },
			{ preferredLanguage: "English" }, // UI-chosen value must win
		)
		expect(plan).toContainEqual({ stateKey: "maxConsecutiveMistakes", value: 5 })
		expect(plan).toContainEqual({ stateKey: "subagentsEnabled", value: true })
		expect(plan.some((entry) => entry.stateKey === "preferredLanguage")).toBe(false)
	})

	it("ignores keys the user never set", () => {
		const plan = computeSettingsImport({ language: "中文" }, {})
		expect(plan).toEqual([{ stateKey: "preferredLanguage", value: "中文" }])
	})

	it("ignores keys with undefined values", () => {
		const plan = computeSettingsImport({ language: undefined }, {})
		expect(plan).toEqual([])
	})

	it("keeps every schema key wired to a state key", () => {
		// Guards against schema/map drift: each settings.json key must map somewhere.
		expect(Object.keys(SETTINGS_SCHEMA_MAP).length).toBeGreaterThan(10)
		for (const stateKey of Object.values(SETTINGS_SCHEMA_MAP)) {
			expect(stateKey.length).toBeGreaterThan(0)
		}
	})
})

describe("computeSettingsOverride (live edits)", () => {
	it("applies a changed settings.json value even when StateManager has one", () => {
		const plan = computeSettingsOverride({ language: "中文" }, { preferredLanguage: "English" })
		expect(plan).toEqual([{ stateKey: "preferredLanguage", value: "中文" }])
	})

	it("skips unchanged values", () => {
		const plan = computeSettingsOverride({ language: "English" }, { preferredLanguage: "English" })
		expect(plan).toEqual([])
	})
})

describe("VscodeSettingsBridge", () => {
	it("imports initial values without clobbering existing state", () => {
		const deps = makeDeps({ language: "中文", subagentsEnabled: true })
		const writer = makeWriter({ subagentsEnabled: true }) // already set in UI
		const bridge = new VscodeSettingsBridge(deps, writer)
		bridge.importInitial()
		expect(writer.store.preferredLanguage).toBe("中文")
		expect(writer.writes).toContain("preferredLanguage")
		expect(writer.writes).not.toContain("subagentsEnabled")
	})

	it("applies live edits on configuration change", () => {
		const deps = makeDeps({ language: "English" })
		const writer = makeWriter({ preferredLanguage: "English" })
		const bridge = new VscodeSettingsBridge(deps, writer)
		bridge.start()

		deps.emit({ affectsConfiguration: (section) => section === "cline" })
		expect(writer.store.preferredLanguage).toBe("English") // unchanged → no write

		deps.readSettingsJson = () => ({ language: "中文" })
		deps.emit({ affectsConfiguration: (section) => section === "cline" })
		expect(writer.store.preferredLanguage).toBe("中文")
	})

	it("ignores configuration changes for other sections", () => {
		const deps = makeDeps({ language: "中文" })
		const writer = makeWriter({})
		const bridge = new VscodeSettingsBridge(deps, writer)
		bridge.start()
		deps.emit({ affectsConfiguration: (section) => section === "editor" })
		expect(writer.store.preferredLanguage).toBeUndefined()
		bridge.dispose()
	})

	it("dispose stops further handling", () => {
		const deps = makeDeps({ language: "中文" })
		const writer = makeWriter({})
		const bridge = new VscodeSettingsBridge(deps, writer)
		bridge.start()
		bridge.dispose()
		deps.emit({ affectsConfiguration: (section) => section === "cline" })
		expect(writer.store.preferredLanguage).toBeUndefined()
	})
})

describe("package.json contributes.configuration schema parity (V14 §2.1)", () => {
	it("declares every settings.json key the bridge reads — IntelliSense + Settings Sync work", () => {
		const pkg = loadPackageJson()
		const declared = new Set(Object.keys(pkg.contributes.configuration.properties))
		for (const schemaKey of Object.keys(SETTINGS_SCHEMA_MAP)) {
			expect(
				declared.has(`cline.${schemaKey}`),
				`cline.${schemaKey} missing from contributes.configuration.properties`,
			).toBe(true)
		}
	})

	it("declares no schema key that has no bridge mapping (no dead schema entries)", () => {
		const pkg = loadPackageJson()
		for (const propertyKey of Object.keys(pkg.contributes.configuration.properties)) {
			const schemaKey = propertyKey.replace(/^cline\./, "")
			expect(SETTINGS_SCHEMA_MAP[schemaKey], `cline.${schemaKey} declared but not wired to a state key`).toBeDefined()
		}
	})

	it("keeps the language enum as real UTF-8 values (no mojibake)", () => {
		const pkg = loadPackageJson()
		const lang = pkg.contributes.configuration.properties["cline.language"]
		expect(lang.enum).toContain("中文")
		expect(lang.enum).toContain("日本語")
		expect(lang.enum).toContain("한국어")
		expect(lang.enum).toContain("Français")
		expect(lang.enum!.length).toBeGreaterThan(10)
	})
})
