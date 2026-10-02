import * as assert from "node:assert/strict"
import { inspect } from "node:util"
import * as mochaNamespace from "mocha"
import mocha, { after, afterEach, before, beforeEach, describe, it } from "mocha"

describe("test-setup.js mocha shim", () => {
	// The runner installs a fresh BDD interface before loading each test file.
	const runnerInterface = {
		after: globalThis.after,
		afterEach: globalThis.afterEach,
		before: globalThis.before,
		beforeEach: globalThis.beforeEach,
		describe: globalThis.describe,
		it: globalThis.it,
	}
	const requiredMocha = require("mocha")
	const unsupportedContext = /Mocha export "Context" is not provided by test-setup\.js mocha shim/

	it("uses all six runner functions for named, namespace, default and CommonJS imports", () => {
		const namedImports = { after, afterEach, before, beforeEach, describe, it }
		for (const name of Object.keys(runnerInterface) as (keyof typeof runnerInterface)[]) {
			for (const imported of [namedImports, mochaNamespace, mocha, requiredMocha]) {
				assert.strictEqual(imported[name], runnerInterface[name], name)
			}
		}
		assert.strictEqual(describe.only, runnerInterface.describe.only)
		assert.strictEqual(describe.skip, runnerInterface.describe.skip)
		assert.strictEqual(it.only, runnerInterface.it.only)
		assert.strictEqual(it.skip, runnerInterface.it.skip)
	})

	it("identifies an unsupported value in an actual compiled named import", () => {
		assert.throws(() => require("./fixtures/mocha-unsupported-export"), unsupportedContext)
	})

	it("identifies unsupported exports through namespace and default imports", () => {
		assert.throws(() => mochaNamespace.Context, unsupportedContext)
		assert.throws(() => mocha.Context, unsupportedContext)
	})

	it("identifies unsupported exports when destructuring require('mocha')", () => {
		assert.throws(() => {
			const { Context } = require("mocha")
			return Context
		}, unsupportedContext)
	})

	it("leaves module interop and JavaScript protocol probes alone", async () => {
		assert.strictEqual(requiredMocha.__esModule, undefined)
		assert.strictEqual(requiredMocha.default, undefined)
		assert.strictEqual(requiredMocha[Symbol.toStringTag], undefined)
		assert.strictEqual(requiredMocha[inspect.custom], undefined)
		assert.strictEqual(requiredMocha.toJSON, undefined)
		assert.strictEqual(await Promise.resolve(requiredMocha), requiredMocha)
		assert.strictEqual(Object.prototype.toString.call(requiredMocha), "[object Object]")
		assert.doesNotThrow(() => inspect(requiredMocha))
	})
})
