export function longestCommonSubsequence(a: string, b: string) {
	const lengths: number[][] = []
	for (let i = 0; i <= a.length; i++) {
		lengths[i] = []
		for (let j = 0; j <= b.length; j++) {
			if (i === 0 || j === 0) {
				lengths[i][j] = 0
			} else if (a[i - 1] === b[j - 1]) {
				lengths[i][j] = lengths[i - 1][j - 1] + 1
			} else {
				lengths[i][j] = Math.max(lengths[i - 1][j], lengths[i][j - 1])
			}
		}
	}
	let result = ""
	let x = a.length
	let y = b.length
	while (x !== 0 && y !== 0) {
		if (lengths[x][y] === lengths[x - 1][y]) {
			x--
		} else if (lengths[x][y] === lengths[x][y - 1]) {
			y--
		} else {
			result = a[x - 1] + result
			x--
			y--
		}
	}
	return result
}
