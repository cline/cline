export function inChunksOf<T>(ary: T[], perChunk = 2) {
	const result = ary.reduce((collect, item, index) => {
		const chunkIndex = Math.floor(index / perChunk)

		if (!collect[chunkIndex]) {
			collect[chunkIndex] = []
		}

		collect[chunkIndex].push(item)
		return collect
	}, [] as T[][])

	return result
}
