/** Encode SDK FileContent's UTF-8 text without a Node Buffer or a full byte array. */
export function utf8ToBase64(text: string): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const chunks: string[] = [];
	let chunk = "";
	let word = 0;
	let count = 0;
	const append = (byte: number) => {
		word = (word << 8) | byte;
		count += 1;
		if (count === 3) {
			chunk +=
				alphabet[(word >> 18) & 63] +
				alphabet[(word >> 12) & 63] +
				alphabet[(word >> 6) & 63] +
				alphabet[word & 63];
			word = 0;
			count = 0;
			if (chunk.length >= 8192) {
				chunks.push(chunk);
				chunk = "";
			}
		}
	};
	for (const character of text) {
		let point = character.codePointAt(0) ?? 0xfffd;
		if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
		if (point < 0x80) append(point);
		else if (point < 0x800) {
			append(0xc0 | (point >> 6));
			append(0x80 | (point & 63));
		} else if (point < 0x10000) {
			append(0xe0 | (point >> 12));
			append(0x80 | ((point >> 6) & 63));
			append(0x80 | (point & 63));
		} else {
			append(0xf0 | (point >> 18));
			append(0x80 | ((point >> 12) & 63));
			append(0x80 | ((point >> 6) & 63));
			append(0x80 | (point & 63));
		}
	}
	if (count) {
		word <<= count === 1 ? 16 : 8;
		chunk +=
			alphabet[(word >> 18) & 63] +
			alphabet[(word >> 12) & 63] +
			(count === 2 ? alphabet[(word >> 6) & 63] : "=") +
			"=";
	}
	chunks.push(chunk);
	return chunks.join("");
}
