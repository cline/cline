import { expect, test } from "vitest"
import { arePathsEqual } from "./path"

test("normalizing a path", () => {
	expect(arePathsEqual("/tmp/./dir", "/tmp/../tmp/dir")).toBe(true)
	expect(arePathsEqual("/tmp/./dir", "/tmp/../dir")).toBe(false)
})
