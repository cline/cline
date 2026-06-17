// Bun test preload — module-substitution aliases for `bun test`.
//
// Background on what bun does automatically and what it does NOT:
//
//   • tsconfig.json `paths` (@/*, @core/*, @shared/*, @shared/proto/cline/*,
//     @utils/*, …) — bun resolves these on its own.
//   • Real workspace packages @cline/llms, @cline/shared and the subpath
//     @cline/shared/storage — bun honors their package.json `exports`/`main`
//     and loads the same dist builds vitest.config.ts aliases them to.
//
// What bun will NOT do is the *module substitution* vitest.config.ts performs
// for two specifiers that have real on-disk implementations we must shadow in
// unit tests:
//
//   vscode       -> src/test/vscode-vitest-stub.ts     (no VSCode host in bun)
//   @cline/core  -> src/test/cline-core-vitest-stub.ts (lightweight SDK stub)
//
// Bun's runtime plugin `onResolve` hook (loaded via preload) does NOT intercept
// these specifiers: `vscode` is treated as a host/builtin-like module and
// `@cline/core` is a symlinked workspace package, both of which bun resolves at
// a layer below the JS plugin resolver (verified empirically — the onResolve
// callback never fires for either specifier). The mechanism that DOES work for
// `bun test` is `mock.module()`, which registers an in-memory module override
// that takes precedence over real resolution for the whole test process.
// A second, subtler parity gap: bun's ESM linker statically validates every
// named import against the *names present on the mock namespace*. The hand-
// written cline-core-vitest-stub.ts only implements the handful of @cline/core
// exports these unit tests actually exercise — but other source files in the
// import graph statically import additional @cline/core names (e.g.
// `prepareRemoteConfigCoreIntegration`, `ClineCore`, `createMcpTools`). Under
// vitest those resolve to `undefined` (vite tolerates missing aliased exports);
// under bun the missing names are a hard "Export named 'X' not found" link
// error. To restore vitest's leniency without bloating the shared stub, we seed
// the mock namespace with every name the *real* @cline/core exports (value
// `undefined`) and then overlay the stub's real implementations on top. Net
// effect: stub names keep stub behavior, every other valid @cline/core import
// links successfully as `undefined` — exactly what vitest does.
//
// Importing the real package here is safe: the preload runs before any test
// file, so this is the only point where the real module is linked, and we only
// read its export *names*, never its behavior (the mock shadows it everywhere
// the tests look).
import { vi as bunVi, mock } from "bun:test"
import * as realClineCore from "@cline/core"
import * as clineCoreStub from "./cline-core-vitest-stub"
import * as vscodeStub from "./vscode-vitest-stub"

const clineCoreNamespace: Record<string, unknown> = {}
for (const name of Object.keys(realClineCore)) {
	clineCoreNamespace[name] = undefined
}
Object.assign(clineCoreNamespace, clineCoreStub)

mock.module("@cline/core", () => clineCoreNamespace)

// `vscode`: the stub provides both named exports (Position, Uri, …) and a
// default export (the namespace object). Preserve both shapes so `import * as
// vscode from "vscode"` and `import vscode from "vscode"` both work.
mock.module("vscode", () => ({ ...vscodeStub, default: vscodeStub.default }))

// `vitest`: the SDK-adapter and model-catalog unit tests import test primitives
// and the `vi` helper namespace from "vitest". bun test provides describe/it/
// expect/etc. and a partial `vi` object under `bun:test`, but does NOT register
// a `vitest` module, so we alias one here, backed by the real bun:test
// implementations wherever a 1:1 mapping exists. The remaining vitest-only
// helpers (`vi.hoisted`, `vi.mock`, `vi.waitFor`, `vi.importActual`,
// `vi.mocked`, `vi.resetModules`) are shimmed on top:
//
//   • vi.hoisted(fn)      — vitest hoists these above imports; under bun's ESM
//                           ordering all imports settle before top-level test
//                           code runs, so simply executing the factory in place
//                           is sufficient (the returned object is referenced by
//                           later vi.mock factory closures, which are lazy).
//   • vi.mock(spec, fac)  — mapped to bun's mock.module. bun applies module
//                           mocks retroactively to already-linked imports, which
//                           matches vitest's hoisted-mock observable behavior.
//   • vi.waitFor(fn,opts) — poll fn until it resolves/returns without throwing.
//   • vi.importActual(s)  — the module as resolved by vitest's `resolve.alias`
//                           BEFORE `vi.mock` is layered on. For specifiers we
//                           substitute via `mock.module` in this preload
//                           (@cline/core, vscode), calling bun's `import()` from
//                           inside a `vi.mock(sameSpecifier)` factory re-enters
//                           the in-flight mock and DEADLOCKS. So we serve those
//                           from a registry of the pre-built "actual" namespaces
//                           (the stub modules vitest's alias points at) and only
//                           fall back to real `import()` for everything else.
//   • vi.mocked(v)        — identity (a TypeScript typing helper at runtime).
//   • vi.resetModules()   — no-op; bun has no module registry to reset and these
//                           suites re-establish their mocks per-test.
const viWaitFor = async <T>(predicate: () => T | Promise<T>, options?: { timeout?: number; interval?: number }): Promise<T> => {
	const timeout = options?.timeout ?? 1000
	const interval = options?.interval ?? 20
	const deadline = Date.now() + timeout
	let lastError: unknown
	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			return await predicate()
		} catch (error) {
			lastError = error
			if (Date.now() >= deadline) {
				throw lastError
			}
			await new Promise((resolve) => setTimeout(resolve, interval))
		}
	}
}

// IMPORTANT: bun has a *built-in* `vitest` → `bun:test` compatibility shim that
// takes precedence over `mock.module("vitest", …)` (the alias does not fire for
// the `vitest` specifier — verified empirically). The `vi` object that bun
// hands to `import { vi } from "vitest"` is the SAME singleton as
// `import { vi } from "bun:test"`. So instead of registering a fake module, we
// augment that shared `vi` singleton in place with the vitest-only helpers
// bun's compat layer omits.
// Registry of pre-built "actual" namespaces for the specifiers this preload
// substitutes. `importActual` serves these directly to avoid the re-entrant
// mock-factory deadlock described above.
const actualNamespaceRegistry: Record<string, unknown> = {
	"@cline/core": clineCoreNamespace,
	vscode: { ...vscodeStub, default: vscodeStub.default },
}

// `vi.mock` → `mock.module`, with two adaptations to match vitest semantics
// that bun's `mock.module` lacks:
//
//  (1) vitest passes an `importOriginal` helper to the factory; bun does not.
//      We pass one (resolving from the "actual" registry, see importActual).
//
//  (2) bun's `mock.module` DEADLOCKS if the factory is an async function that
//      actually suspends on an `await` — bun blocks the importing thread on the
//      returned promise without pumping the microtask queue (verified
//      empirically; bun's docs only ever show async factories that return
//      synchronously). vitest, by contrast, awaits async `vi.mock` factories
//      (e.g. ones that `await importOriginal()` / `await vi.importActual(...)`).
//      To bridge this without rewriting test files we invoke the factory
//      OURSELVES:
//        • sync result  → register it directly.
//        • promise result → register a synchronous placeholder FIRST (seeded
//          with the original module's export names so consumers' named imports
//          link), then re-register synchronously with the resolved namespace
//          once the promise settles. A plain deferred-only register does NOT
//          propagate to already-linked *named* imports — the up-front
//          placeholder is what makes the live-binding update stick. `vi.mock`
//          runs at module top level and tests only run after an await boundary,
//          so the resolved registration is always in place before the first
//          test executes.
const resolveOriginalNamespace = (specifier: string): unknown => {
	if (specifier in actualNamespaceRegistry) {
		return actualNamespaceRegistry[specifier]
	}
	try {
		// bun resolves `require` synchronously for both ESM and CJS workspace deps.
		return (globalThis as { require?: (id: string) => unknown }).require?.(specifier)
	} catch {
		return undefined
	}
}

const viMock = (specifier: string, factory?: (importOriginal?: () => unknown) => unknown) => {
	if (typeof factory !== "function") {
		return mock.module(specifier, () => ({}))
	}
	const importOriginal = () => resolveOriginalNamespace(specifier)
	const result = factory(importOriginal)
	if (result && typeof (result as { then?: unknown }).then === "function") {
		// Seed a synchronous placeholder carrying the original export names so
		// consumers' named imports link before the async factory resolves.
		const original = resolveOriginalNamespace(specifier)
		const placeholder: Record<string, unknown> = {}
		if (original && typeof original === "object") {
			for (const name of Object.keys(original as object)) {
				placeholder[name] = (original as Record<string, unknown>)[name]
			}
		}
		mock.module(specifier, () => placeholder)
		void (result as Promise<unknown>).then((resolved) => {
			// Mutate the SAME placeholder object the live ESM bindings already
			// reference, then re-register it. Copying onto the existing object
			// (rather than swapping in a fresh one) is what makes already-linked
			// *named* imports observe the resolved values — re-registering a brand
			// new object can race the first test before the binding updates.
			if (resolved && typeof resolved === "object") {
				for (const name of Object.keys(resolved as object)) {
					placeholder[name] = (resolved as Record<string, unknown>)[name]
				}
			}
			mock.module(specifier, () => placeholder)
		})
		return
	}
	return mock.module(specifier, () => result as object)
}

const viExtensions: Record<string, unknown> = {
	mocked: (value: unknown) => value,
	mock: viMock,
	hoisted: <T>(factory: () => T): T => factory(),
	// NOTE: return the registry value *synchronously* (not via an async
	// function) for known specifiers. bun blocks synchronously while awaiting an
	// async `vi.mock` factory and does not pump the microtask queue, so an
	// `async` importActual would never settle its continuation from inside a
	// factory → deadlock. Returning the plain namespace lets the factory's
	// `await` resolve in the same tick. Only the (rare) real-import fallback
	// returns a Promise.
	importActual: <T = unknown>(specifier: string): T | Promise<T> => {
		if (specifier in actualNamespaceRegistry) {
			return actualNamespaceRegistry[specifier] as T
		}
		return import(specifier) as Promise<T>
	},
	importMock: <T = unknown>(specifier: string): Promise<T> => import(specifier) as Promise<T>,
	resetModules: () => bunVi,
	waitFor: viWaitFor,
}
// Force-install every entry: these are intentional replacements/additions.
// In particular `vi.mock` ALREADY exists on bun's `vi` (and is the one that
// deadlocks on async factories), so it must be overwritten, not skipped.
for (const [name, impl] of Object.entries(viExtensions)) {
	;(bunVi as Record<string, unknown>)[name] = impl
}
