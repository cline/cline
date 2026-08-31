/** Renderer-free fuzzy scoring shared by the model selector dialogs. */

export interface ModelSearchCandidate {
	key: string;
	name: string;
	family?: string;
}

function normalize(s: string): string {
	return s.replace(/[^a-z0-9.]/g, "");
}

function fuzzyMatch(text: string, query: string): boolean {
	let qi = 0;
	for (let i = 0; i < text.length && qi < query.length; i++) {
		if (text[i] === query[qi]) qi++;
	}
	return qi === query.length;
}

/** Higher is better; 0 means no match. Query must be lowercase. */
export function fuzzyScore(model: ModelSearchCandidate, query: string): number {
	const name = model.name.toLowerCase();
	const key = model.key.toLowerCase();
	const nName = normalize(name);
	const nKey = normalize(key);
	const nQuery = normalize(query);
	if (nName === nQuery || nKey === nQuery) return 100;
	if (nName.startsWith(nQuery)) return 90;
	if (nKey.startsWith(nQuery)) return 85;
	if (nName.includes(nQuery)) return 70;
	if (nKey.includes(nQuery)) return 65;
	const family = model.family?.toLowerCase();
	if (family && normalize(family).includes(nQuery)) return 50;
	if (fuzzyMatch(nName, nQuery)) return 30;
	if (fuzzyMatch(nKey, nQuery)) return 25;
	return 0;
}
