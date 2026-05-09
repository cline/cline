function computeLcs(a: string[], b: string[]): number[][] {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array(n + 1).fill(0),
	);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1] + 1
					: Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	return dp;
}

function diffLines(
	oldLines: string[],
	newLines: string[],
): { type: "+" | "-" | " "; line: string }[] {
	const dp = computeLcs(oldLines, newLines);
	const result: { type: "+" | "-" | " "; line: string }[] = [];
	let i = oldLines.length;
	let j = newLines.length;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			result.unshift({ type: " ", line: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.unshift({ type: "+", line: newLines[j - 1] });
			j--;
		} else {
			result.unshift({ type: "-", line: oldLines[i - 1] });
			i--;
		}
	}
	return result;
}

export function makeUnifiedDiff(
	oldText: string,
	newText: string,
	filePath: string,
	ctx = 3,
): string {
	const oldArr = oldText ? oldText.split("\n") : [];
	const newArr = newText.split("\n");
	const ops = diffLines(oldArr, newArr);

	const output: string[] = [];
	output.push(`--- a/${filePath}`);
	output.push(`+++ b/${filePath}`);

	let i = 0;
	while (i < ops.length) {
		if (ops[i].type === " ") {
			i++;
			continue;
		}

		const hunkStart = Math.max(0, i - ctx);
		let end = i;
		while (end < ops.length) {
			if (ops[end].type !== " ") {
				end++;
				continue;
			}
			let next = end;
			while (next < ops.length && ops[next].type === " ") next++;
			if (next < ops.length && next - end <= ctx * 2) {
				end = next + 1;
			} else {
				break;
			}
		}
		const hunkEnd = Math.min(ops.length, end + ctx);

		let oldCount = 0;
		let newCount = 0;
		for (let k = hunkStart; k < hunkEnd; k++) {
			if (ops[k].type !== "+") oldCount++;
			if (ops[k].type !== "-") newCount++;
		}

		let oldStart = 1;
		let newStart = 1;
		for (let k = 0; k < hunkStart; k++) {
			if (ops[k].type !== "+") oldStart++;
			if (ops[k].type !== "-") newStart++;
		}

		output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
		for (let k = hunkStart; k < hunkEnd; k++) {
			const prefix = ops[k].type === " " ? " " : ops[k].type;
			output.push(`${prefix}${ops[k].line}`);
		}

		i = hunkEnd;
	}

	return output.join("\n");
}

export function hunkHeader(lines: string[]): string {
	let oldCount = 0;
	let newCount = 0;
	for (const l of lines) {
		if (!l.startsWith("+")) oldCount++;
		if (!l.startsWith("-")) newCount++;
	}
	return `@@ -1,${oldCount} +1,${newCount} @@`;
}
