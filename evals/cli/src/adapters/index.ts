import { BenchmarkAdapter } from "./types"
import { ExercismAdapter } from "./exercism"
import { SWEBenchAdapter } from "./swe-bench"
import { SWELancerAdapter } from "./swelancer"
import { MultiSWEAdapter } from "./multi-swe"

// Registry of all available adapters
const adapters: Record<string, BenchmarkAdapter> = {
	// Exercism is the primary adapter with real implementation
	exercism: new ExercismAdapter(),

	// Dummy adapters for testing
	"swe-bench": new SWEBenchAdapter(),
	swelancer: new SWELancerAdapter(),
	"multi-swe": new MultiSWEAdapter(),
}

/**
 * Get a specific adapter by name
 * @param name The name of the adapter to get
 * @returns The requested adapter
 * @throws Error if the adapter is not found
 */
export function getAdapter(name: string): BenchmarkAdapter {
	const adapter = adapters[name]
	if (!adapter) {
		throw new Error(`Adapter for benchmark '${name}' not found`)
	}
	return adapter
}

/**
 * Get all available adapters
 * @returns Array of all registered adapters
 */
export function getAllAdapters(): BenchmarkAdapter[] {
	return Object.values(adapters)
}

/**
 * Register a new adapter
 * @param name The name to register the adapter under
 * @param adapter The adapter to register
 */
export function registerAdapter(name: string, adapter: BenchmarkAdapter): void {
	adapters[name] = adapter
}
