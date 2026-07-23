export type IdempotencyRegistry<Key> = {
	claim: (key: Key) => boolean;
};

export function createIdempotencyRegistry<Key>(): IdempotencyRegistry<Key> {
	const claimed = new Set<Key>();

	return {
		claim(key) {
			if (claimed.has(key)) {
				return false;
			}
			claimed.add(key);
			return true;
		},
	};
}
