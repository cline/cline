import type { MarketplaceEntry, MarketplaceLocalInstalledEntry } from "@shared/proto/cline/marketplace"

function installArgs(entry: MarketplaceEntry): string[] {
	return entry.install?.args ?? []
}

export function localEntryKey(entry: MarketplaceLocalInstalledEntry): string {
	return `${entry.type}:${entry.id}:${entry.path}`
}

function normalizeMatchValue(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function pathBaseName(value: string | undefined): string | undefined {
	const segments = (value ?? "").split(/[\\/]/).filter(Boolean)
	const last = segments.at(-1)
	if (!last) return undefined
	if (last.toLowerCase() === "skill.md" && segments.length > 1) {
		return segments.at(-2)
	}
	return last.replace(/\.[^.]+$/, "")
}

function sourceBaseName(value: string | undefined): string | undefined {
	const withoutFragment = value?.split("#")[0]?.split("?")[0]
	return pathBaseName(withoutFragment)
}

function stripPluginInstallSuffix(value: string | undefined): string | undefined {
	return value?.replace(/-[0-9a-f]{12}$/i, "")
}

function addMatchValue(values: Set<string>, value: string | undefined): void {
	const normalized = normalizeMatchValue(value)
	if (normalized && normalized !== "skill") {
		values.add(normalized)
	}
}

function entrySkillMatchValues(entry: MarketplaceEntry): Set<string> {
	const values = new Set<string>()
	addMatchValue(values, entry.id)
	addMatchValue(values, entry.name)
	const args = installArgs(entry)
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]
		if ((arg === "--skill" || arg === "-s") && args[index + 1]) {
			addMatchValue(values, args[index + 1])
			index++
			continue
		}
		const skillFilter = arg.split("@").at(1)
		if (skillFilter) {
			addMatchValue(values, skillFilter)
			continue
		}
		if (arg.includes("/") || arg.includes("\\")) {
			addMatchValue(values, sourceBaseName(arg))
		}
	}
	return values
}

function entryMatchValues(entry: MarketplaceEntry): Set<string> {
	if (entry.type === "skill") return entrySkillMatchValues(entry)

	const values = new Set<string>()
	addMatchValue(values, entry.id)
	addMatchValue(values, entry.name)

	const [source] = installArgs(entry)
	if (entry.type === "plugin") {
		addMatchValue(values, source)
		addMatchValue(values, stripPluginInstallSuffix(sourceBaseName(source)))
	} else if (entry.type === "mcp") {
		addMatchValue(values, source)
	}
	return values
}

function localEntryMatchValues(entry: MarketplaceLocalInstalledEntry): Set<string> {
	const values = new Set<string>()
	addMatchValue(values, entry.id)
	addMatchValue(values, entry.name)

	if (entry.type === "skill") {
		addMatchValue(values, pathBaseName(entry.path))
	} else if (entry.type === "plugin") {
		addMatchValue(values, stripPluginInstallSuffix(pathBaseName(entry.path)))
	}
	return values
}

export function entryMatchesLocalEntry(entry: MarketplaceEntry, localEntry: MarketplaceLocalInstalledEntry): boolean {
	if (entry.type !== localEntry.type) return false
	const marketplaceValues = entryMatchValues(entry)
	for (const localValue of localEntryMatchValues(localEntry)) {
		if (marketplaceValues.has(localValue)) return true
	}
	return false
}
