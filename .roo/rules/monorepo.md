# Monorepo (pnpm)

- Work primarily in:  
  • src/  
  • webview-ui/package  
  • packages/types (shared DTOs)
- Other workspaces (modify only if instructed):  
  • evals/  
  • packages/_/  
  • apps/_/  
  • [others]
- To install deps:  
  → run `pnpm add <package>` in `<cwd>workspace/directory</cwd>` (updates `<workspace>/package.json`)
- ⚠️ DO NOT run pnpm in root (root only holds CLI dev-tools in devDependencies, e.g. prettier)

# Turborepo

- ❌ Don’t modify `turbo` config without instruction
- ✅ You may propose config changes when:
    1. Adding a shared, cacheable npm task
    2. Declaring an internal-package dependency that affects the extension build

# Running tests

- Always execute commands using `<cwd>workspace/directory</cwd>` when running any test command
- To fix failures:
    1. Target one failing test:  
       → `npx vitest relative/path/__tests__/name.spec.ts -t "substring"`
    2. Verify all tests in that module pass:  
       → `npx vitest relative/path/__tests__/name.spec.ts`
- File conventions:  
  • `.spec.ts` → vitest  
  • `.test.ts` → jest (deprecated)
- If a test in `.test.ts` fails:  
  → delete it & recreate in `.spec.ts`
- Keep passing tests in `.test.ts`
- Use `npx jest <file> -t "substring"` for deprecated test execution using the same strategy above
- Run all tests in the root workspace:  
  → `pnpm test`

# Creating tests

- Use vitest (native ESM, jest-compatible)
- Steps:
    1. Create `path/to/__tests__/name.spec.ts` (must be `.spec.ts`)
    2. Omit ESM mocks unless necessary
    3. Run via vitest
- For modules with existing `.test.ts`:
    1. Move any failing tests → `name.spec.ts`
    2. Add new tests → `name.spec.ts`
    3. Leave successful tests in `.test.ts`
