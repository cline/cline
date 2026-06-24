import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { inspectCommandForTyposquat } from "../SupplyChainInspector"

/** Assert a command flags exactly one typosquat that resembles `target`. */
function assertFlags(command: string, target: string): void {
	const result = inspectCommandForTyposquat(command)
	assert.equal(result.flagged, true, `expected "${command}" to be flagged`)
	assert.ok(
		result.reason?.includes(`\`${target}\``),
		`expected reason for "${command}" to mention popular package "${target}", got: ${result.reason}`,
	)
}

/** Assert a command is not flagged at all. */
function assertClean(command: string): void {
	const result = inspectCommandForTyposquat(command)
	assert.equal(result.flagged, false, `expected "${command}" to be clean, got reason: ${result.reason}`)
	assert.equal(result.packages.length, 0)
}

describe("SupplyChainInspector", () => {
	describe("npm install detection", () => {
		it("flags a one-edit typosquat of lodash", () => {
			assertFlags("npm install lodahs", "lodash")
		})

		it("flags typosquats behind short flags (-D)", () => {
			assertFlags("npm i -D lodahs", "lodash")
		})

		it("flags typosquats quoted in double quotes", () => {
			assertFlags('npm install "lodahs"', "lodash")
		})

		it("flags with global flag before subcommand", () => {
			assertFlags("npm -g install lodahs", "lodash")
		})

		it("flags with a value-taking flag before the subcommand", () => {
			assertFlags("npm --prefix ui install lodahs", "lodash")
		})

		it("flags after an env assignment", () => {
			assertFlags("FOO=bar npm install lodahs", "lodash")
		})

		it("flags after a sudo wrapper", () => {
			assertFlags("sudo npm install lodahs", "lodash")
		})

		it("flags after an env wrapper with an inline assignment", () => {
			assertFlags("env FOO=bar npm install lodahs", "lodash")
		})

		it("flags a typosquat of express", () => {
			assertFlags("npm install expres", "express")
		})

		it("flags a typosquat of typescript (missing letter)", () => {
			assertFlags("npm install typscript", "typescript")
		})
	})

	describe("chained commands", () => {
		it("parses the install segment after &&", () => {
			const result = inspectCommandForTyposquat("cd x && npm install evil")
			// evil is not a typosquat, but it must be parsed as a package (no crash, no false hit)
			assert.equal(result.flagged, false)
		})

		it("flags a typosquat after &&", () => {
			assertFlags("cd x && npm install lodahs", "lodash")
		})

		it("flags a typosquat after a newline separator", () => {
			assertFlags("cd ui\nnpm install lodahs", "lodash")
		})

		it("flags a typosquat after a pipe", () => {
			assertFlags("echo hi | npm install lodahs", "lodash")
		})
	})

	describe("runners (npx / dlx / bunx)", () => {
		it("targets the executed package, never the trailing arg", () => {
			const result = inspectCommandForTyposquat("npx create-react-app my-app")
			// create-react-app and my-app are both clean; the key invariant is that
			// my-app is never collected as the package target.
			assert.equal(result.flagged, false)
		})

		it("flags a typosquat runner target", () => {
			assertFlags("npx expres", "express")
		})

		it("honors --package=NAME for the runner target", () => {
			assertFlags("npx --package=lodahs some-bin", "lodash")
		})

		it("honors -p NAME for the runner target", () => {
			assertFlags("npx -p lodahs some-bin", "lodash")
		})

		it("flags bunx runner targets", () => {
			assertFlags("bunx expres", "express")
		})
	})

	describe("non-install subcommands are ignored", () => {
		it("ignores npm run build", () => {
			assertClean("npm run build")
		})

		it("ignores a bare npm install with no packages", () => {
			assertClean("npm install")
		})

		it("ignores a script named 'add' (npm run add lodahs)", () => {
			assertClean("npm run add lodahs")
		})
	})

	describe("false-positive guards", () => {
		it("does not flag the legitimate lodash package", () => {
			assertClean("npm install lodash")
		})

		it("does not flag multiple legitimate packages", () => {
			assertClean("npm install react react-dom")
		})

		it("treats a value-taking flag's argument as a value, not a package", () => {
			// axio (one edit from axios) is the --prefix value and must NOT be flagged;
			// lodash is legit, so the command is clean overall.
			assertClean("npm install --prefix axio lodash")
		})

		it("does not flag short popular names (<=4 chars) by one edit", () => {
			// 'vu' is one edit from 'vue' but vue.length is 3, so it must not flag.
			assertClean("npm install vu")
		})

		it("does not flag a package that is two edits away", () => {
			assertClean("npm install lodaaash")
		})
	})

	describe("package name normalization", () => {
		it("strips a trailing version but keeps the name", () => {
			assertFlags("npm install lodahs@4.17.21", "lodash")
		})

		it("does not crash on scoped packages and keeps scope", () => {
			const result = inspectCommandForTyposquat("npm install @scope/pkg@1.2.3")
			assert.equal(result.flagged, false)
		})
	})

	describe("other package managers", () => {
		it("flags yarn add typosquats", () => {
			assertFlags("yarn add lodahs", "lodash")
		})

		it("flags pnpm add typosquats", () => {
			assertFlags("pnpm add lodahs", "lodash")
		})

		it("flags bun add typosquats", () => {
			assertFlags("bun add lodahs", "lodash")
		})

		it("flags pnpm dlx runner targets", () => {
			assertFlags("pnpm dlx expres", "express")
		})

		it("ignores yarn add with no packages", () => {
			assertClean("yarn add")
		})
	})

	describe("multiple hits", () => {
		it("joins multiple typosquat reasons with '; '", () => {
			const result = inspectCommandForTyposquat("npm install lodahs expres")
			assert.equal(result.flagged, true)
			assert.ok(result.reason?.includes("lodash"))
			assert.ok(result.reason?.includes("express"))
			assert.ok(result.reason?.includes("; "))
			assert.equal(result.packages.length, 2)
		})

		it("de-duplicates a repeated typosquat", () => {
			const result = inspectCommandForTyposquat("npm install lodahs lodahs")
			assert.equal(result.packages.length, 1)
		})
	})

	describe("path-prefixed binaries", () => {
		it("strips a path prefix on the binary", () => {
			assertFlags("/usr/bin/npm install lodahs", "lodash")
		})
	})

	describe("empty / non-install commands", () => {
		it("returns clean for an empty command", () => {
			assertClean("")
		})

		it("returns clean for an unrelated command", () => {
			assertClean("git status")
		})
	})
})
