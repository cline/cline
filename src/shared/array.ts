/**
 * 返回数组中 predicate 为 true 的最后一个元素的索引，以及 -1
 *否则。
 * @param array 要搜索的源数组
 * @param predicate find 对数组的每个元素调用一次 predicate，降序
 * order 中，直到找到 predicate 返回 true 的 ONE。如果找到这样的元素，
 * findLastIndex 立即返回该元素索引。否则，findLastIndex 返回 -1。
 */
export function findLastIndex<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
	let l = array.length
	while (l--) {
		if (predicate(array[l], l, array)) {
			return l
		}
	}
	return -1
}

export function findLast<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): T | undefined {
	const index = findLastIndex(array, predicate)
	return index === -1 ? undefined : array[index]
}
