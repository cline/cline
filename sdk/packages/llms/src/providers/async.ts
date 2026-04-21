export async function* toAsyncIterable<T>(
	value: AsyncIterable<T> | Iterable<T>,
): AsyncIterable<T> {
	for await (const item of value) {
		yield item;
	}
}
