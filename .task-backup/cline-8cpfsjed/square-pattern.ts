/**
 * Print 25..1 (descending) and 1..25 (ascending) as square patterns.
 *
 * 25 == 5 * 5, so the numbers tile a perfect 5x5 square.
 * Each cell is right-aligned to the widest number so the columns line up.
 */

const TOTAL = 25
const SIDE = Math.sqrt(TOTAL) // 5

/** Right-align `value` in a field of `width` characters. */
function pad(value: number, width: number): string {
	return String(value).padStart(width, " ")
}

/** Render `numbers` as a `side` x `side` grid. */
function printSquare(title: string, numbers: number[], side: number): void {
	const width = Math.max(...numbers.map((n) => String(n).length))

	console.log(title)
	for (let row = 0; row < side; row++) {
		const cells: string[] = []
		for (let col = 0; col < side; col++) {
			cells.push(pad(numbers[row * side + col], width))
		}
		console.log(cells.join(" "))
	}
	console.log("")
}

// 25, 24, 23, ... 1
const descending = Array.from({ length: TOTAL }, (_, i) => TOTAL - i)

// 1, 2, 3, ... 25
const ascending = Array.from({ length: TOTAL }, (_, i) => i + 1)

printSquare("Descending square (25 -> 1):", descending, SIDE)
printSquare("Ascending square (1 -> 25):", ascending, SIDE)
