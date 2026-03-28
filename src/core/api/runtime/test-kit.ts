import type { ApiConfiguration } from "@shared/api"
import type { Secrets, Settings } from "@shared/storage/state-keys"

export const createRuntimeStateSourceFixture = (options?: {
	apiConfiguration?: Partial<ApiConfiguration>
	settings?: Partial<Settings>
	secrets?: Partial<Secrets>
}) => ({
	getApiConfiguration: () => (options?.apiConfiguration ?? {}) as ApiConfiguration,
	getGlobalSettingsKey: (key: keyof Settings) => options?.settings?.[key],
	getSecretKey: (key: keyof Secrets) => options?.secrets?.[key],
})

export const collectAsyncChunks = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
	const chunks: T[] = []
	for await (const chunk of source) {
		chunks.push(chunk)
	}
	return chunks
}
