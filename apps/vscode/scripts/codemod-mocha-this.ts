#!/usr/bin/env bun
/**
 * Codemod: convert mocha test-context APIs that bun:test does not provide.
 *
 *   it("name", async function () { this.timeout(N); ... })
 *     -> it("name", async function () { ... }, N)   // N becomes bun's per-test timeout
 *
 *   this.skip()  ->  return   // bun has no runtime this.skip(); the call sites here
 *                              // are all guarded by platform checks that never run on
 *                              // the CI platform, so an early return preserves behavior.
 *
 * Only `this.timeout()` / `this.skip()` invocations are touched. The enclosing
 * function expression is left as a `function`, so `this` is otherwise untouched.
 */
import { CallExpression, Node, Project, SyntaxKind } from "ts-morph"

const files = process.argv.slice(2)
if (files.length === 0) {
	console.error("usage: codemod-mocha-this.ts <file...>")
	process.exit(1)
}

const project = new Project({ tsConfigFilePath: undefined, skipAddingFilesFromTsConfig: true })

function findEnclosingTestCall(node: Node): CallExpression | undefined {
	let current: Node | undefined = node
	while (current) {
		const fn = current.getFirstAncestor((a) => Node.isFunctionExpression(a) || Node.isArrowFunction(a))
		if (!fn) {
			return undefined
		}
		const parent = fn.getParent()
		if (Node.isCallExpression(parent)) {
			const expr = parent.getExpression().getText()
			const base = expr.split(".")[0]
			if (base === "it" || base === "test") {
				return parent
			}
		}
		current = fn
	}
	return undefined
}

for (const filePath of files) {
	const sf = project.addSourceFileAtPath(filePath)
	let changed = false

	// Collect this.timeout(...) and this.skip() calls.
	const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
	const timeoutCalls: { call: CallExpression; arg: string }[] = []
	const skipCalls: CallExpression[] = []

	for (const call of calls) {
		const expr = call.getExpression()
		if (!Node.isPropertyAccessExpression(expr)) {
			continue
		}
		if (expr.getExpression().getKind() !== SyntaxKind.ThisKeyword) {
			continue
		}
		const name = expr.getName()
		if (name === "timeout") {
			const arg = call.getArguments()[0]?.getText() ?? ""
			timeoutCalls.push({ call, arg })
		} else if (name === "skip") {
			skipCalls.push(call)
		}
	}

	// Apply timeout conversions: add 3rd arg to enclosing it()/test(), then remove
	// the this.timeout statement.
	for (const { call, arg } of timeoutCalls) {
		const testCall = findEnclosingTestCall(call)
		if (testCall && arg) {
			const args = testCall.getArguments()
			if (args.length === 2) {
				testCall.addArgument(arg)
				changed = true
			}
		}
		const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement)
		if (stmt) {
			stmt.remove()
			changed = true
		}
	}

	// Convert this.skip() -> return.
	for (const call of skipCalls) {
		const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement)
		if (stmt) {
			stmt.replaceWithText("return")
			changed = true
		}
	}

	if (changed) {
		sf.saveSync()
		console.log(`updated ${filePath}`)
	} else {
		console.log(`no change ${filePath}`)
	}
}
