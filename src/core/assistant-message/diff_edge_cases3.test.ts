import { constructNewFileContent as cnfc2 } from "./diff"
import { describe, it } from "mocha"
import { expect } from "chai"

describe("constructNewFileContent", () => {
	it("should use the most similar block when multiple matches are found", async () => {
		const original = `/** 
 * comment1-1
 * comment1-2
 * comment1-3
 */
function foo(){
    // foo
}

/**
 * comment2-1
 * comment2-2
 * comment2-3
 */
function bar(){
    // bar
}`
		const diff = `<<<<<<< SEARCH
/**
 * comment2-1.diff
 * comment2-2
 * comment2-3
 */
function bar(){
    // bar
}
=======
/**
 * comment2-1
 * comment2-2
 * comment2-3
 */
function bar(){
    // new bar
}
>>>>>>> REPLACE
`
		const result1 = await cnfc2(diff, original, true)
		expect(result1).to.equal(`/** 
 * comment1-1
 * comment1-2
 * comment1-3
 */
function foo(){
    // foo
}

/**
 * comment2-1
 * comment2-2
 * comment2-3
 */
function bar(){
    // new bar
}
`)
	})

	it("should use the single matched block when only one is found", async () => {
		const original = `/** 
 * comment1-1
 * comment1-2
 * comment1-3
 */
function foo(){
    // foo
}

/**
 * comment2-1
 * comment2-2
 */
function bar(){
    // bar
}`
		const diff = `<<<<<<< SEARCH
/**
 * comment2-1.diff
 * comment2-2
 */
function bar(){
    // bar
}
=======
/**
 * comment2-1
 * comment2-2
 */
function bar(){
    // new bar
}
>>>>>>> REPLACE
`
		const result1 = await cnfc2(diff, original, true)
		expect(result1).to.equal(`/** 
 * comment1-1
 * comment1-2
 * comment1-3
 */
function foo(){
    // foo
}

/**
 * comment2-1
 * comment2-2
 */
function bar(){
    // new bar
}
`)
	})

	it("should match blocks with only 3 lines", async () => {
		const original = `/** 
 * comment1-1
 * comment1-2
 * comment1-3
 */
function foo(){
    // foo
}

/**
 * comment2-1
 */
`
		const diff = `<<<<<<< SEARCH
/**
 * comment2-1.diff
 */
=======
/**
 * comment2-1
 */
function bar(){
    // new bar
}
>>>>>>> REPLACE
`
		const result1 = await cnfc2(diff, original, true)
		expect(result1).to.equal(`/** 
 * comment1-1
 * comment1-2
 * comment1-3
 */
function foo(){
    // foo
}

/**
 * comment2-1
 */
function bar(){
    // new bar
}
`)
	})
})
