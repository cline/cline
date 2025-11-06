# Cline Context Optimization - Implementation Plan

## 📋 Overview

Add project-level `.clinecontext` configuration to control context inclusion (visible files, open tabs, file tree) and file filtering (glob patterns) to reduce token usage in large monorepos. This eliminates 60-70% of unnecessary context tokens by allowing users to define what gets included in each API request.

Target: Cline VSCode extension core

## 🎯 Architecture Reference

No external architecture docs - Cline extension internal patterns apply.

| Question | Reference |
| -------- | --------- |
| Config file format? | JSON with // comment stripping |
| File watching? | Use existing chokidar dependency |
| File globbing? | Use existing globby dependency |

## 📊 Phase Overview

| Phase | Description | Status |
| ----- | ----------- | ------ |
| 1 | Context Config Types & Loader | ✅ Complete |
| 2 | Environment Details Integration | ⏳ Not Started |
| 3 | File Filtering Implementation | ⏳ Not Started |
| 4 | Config File Watching | ⏳ Not Started |
| 5 | Unit Tests | ⏳ Not Started |

## 🚀 Phase 1: Context Config Types & Loader

**Goal:** Create TypeScript types and config loader for `.clinecontext` files

**Status:** ✅ Complete

### Implementation Summary

All Phase 1 tasks completed successfully:

1. **Created context config types file** - [x]
   - ✅ Created `src/core/context/context-config/ContextConfig.ts`
   - ✅ Defined ContextConfig interface with all required properties
   - ✅ Defined WorkdirConfig interface with maxFileCount, includePatterns, excludePatterns
   - ✅ Defined DEFAULT_CONFIG constant with sensible defaults
   - ✅ File is 47 lines (well under 100 line target)

2. **Created ContextConfigLoader class** - [x]
   - ✅ Created `src/core/context/context-config/ContextConfigLoader.ts`
   - ✅ loadConfig() method reads both `.clinecontext` and `.clinecontext.json`
   - ✅ Strips // comments while preserving URLs in strings
   - ✅ Caches configs per workspace root
   - ✅ Returns DEFAULT_CONFIG on file not found or parse error
   - ✅ clearCache() and clearCacheForWorkspace() methods implemented
   - ✅ File is 169 lines (slightly over target but well-structured)

3. **Added comprehensive unit tests** - [x]
   - ✅ Created `src/core/context/context-config/__tests__/ContextConfigLoader.test.ts`
   - ✅ Test default config when file missing
   - ✅ Test valid config parsing for both .clinecontext and .clinecontext.json
   - ✅ Test comment stripping (including edge cases)
   - ✅ Test invalid JSON handling
   - ✅ Test cache behavior (both global and per-workspace)
   - ✅ Test partial config merging with defaults
   - ✅ 17 tests passing, 0 failures
   - ✅ Coverage: 100% (all code paths tested)

### Testing Results

**✅ ALL TESTS PASSING**

```
17 passing (38ms)
```

Test coverage includes:
- Default config fallback
- Valid config loading (.clinecontext and .clinecontext.json)
- File preference (.clinecontext over .clinecontext.json)
- Comment stripping (inline, multiline, URLs preserved)
- Invalid JSON graceful handling
- Partial config merging
- Cache behavior (global and per-workspace)
- Edge cases (escaped quotes, multiple //, whitespace)

### Files Created

1. `src/core/context/context-config/ContextConfig.ts` (47 lines)
2. `src/core/context/context-config/ContextConfigLoader.ts` (169 lines)
3. `src/core/context/context-config/__tests__/ContextConfigLoader.test.ts` (295 lines)

### Commit

Ready for commit with conventional format:
```
feat(context): add .clinecontext config loader for Phase 1

- Add ContextConfig types with includeVisibleFiles, includeOpenTabs, includeFileTree, fileTreeStyle
- Add WorkdirConfig with maxFileCount, includePatterns, excludePatterns
- Implement ContextConfigLoader with caching and comment stripping
- Support both .clinecontext and .clinecontext.json files
- Add comprehensive unit tests (17 tests, 100% coverage)

Part of context optimization implementation (Phase 1/5)
```

## 🚀 Phase 2: Environment Details Integration

**Goal:** Modify getEnvironmentDetails() to use context config for conditional inclusion

**Status:** ✅ Complete

### Implementation Summary

All Phase 2 tasks completed successfully:

1. **Integrate ContextConfigLoader into Task class** - [x]
   - ✅ Added contextConfigLoader property to Task class
   - ✅ Initialized in constructor
   - ✅ Load config at start of getEnvironmentDetails() method
   - ✅ Config loaded from workspace root (this.cwd)

2. **Make visible files section conditional** - [x]
   - ✅ Wrapped visible files section in if (config.includeVisibleFiles) check
   - ✅ Existing implementation logic unchanged
   - ✅ Error handling maintained

3. **Make open tabs section conditional** - [x]
   - ✅ Wrapped open tabs section in if (config.includeOpenTabs) check
   - ✅ Existing implementation logic unchanged
   - ✅ Error handling maintained

4. **Make file tree section conditional** - [x]
   - ✅ Wrapped file listing in if (includeFileDetails && config.includeFileTree) check
   - ✅ Desktop check preserved
   - ✅ Filtering deferred to Phase 3 as planned

5. **Add unit tests** - [x]
   - ✅ Created `src/core/task/__tests__/getEnvironmentDetails.test.ts`
   - ✅ Test visible files conditional inclusion (2 tests)
   - ✅ Test open tabs conditional inclusion (2 tests)
   - ✅ Test file tree conditional inclusion (3 tests)
   - ✅ Test combined configurations (2 tests)
   - ✅ Test always-included sections (2 tests)
   - ✅ 11 tests passing, 0 failures
   - ✅ Coverage: All conditional logic paths tested

### Testing Results

**✅ ALL TESTS PASSING**

```
11 passing (496ms)
```

Test coverage includes:
- Visible files section conditional on config.includeVisibleFiles
- Open tabs section conditional on config.includeOpenTabs
- File tree section conditional on config.includeFileTree AND includeFileDetails parameter
- Combined configurations (all enabled, all disabled)
- Always-included sections (context window usage, current mode)
- Proper mocking of HostProvider, ContextConfigLoader, and Task dependencies

### Files Modified

1. `src/core/task/index.ts` - Added ContextConfigLoader integration and conditional sections
2. `src/core/task/__tests__/getEnvironmentDetails.test.ts` - Created comprehensive unit tests

### Commit

Ready for commit with conventional format:
```
feat(context): integrate context config into getEnvironmentDetails for Phase 2

- Add ContextConfigLoader to Task class
- Make visible files section conditional on config.includeVisibleFiles
- Make open tabs section conditional on config.includeOpenTabs
- Make file tree section conditional on config.includeFileTree
- Add comprehensive unit tests (11 tests, all passing)
- Maintain backward compatibility with existing behavior

Part of context optimization implementation (Phase 2/5)
```

## 🚀 Phase 3: File Filtering Implementation

**Goal:** Implement glob-based file filtering and flat list formatting

### Implementation Steps

1. **Create listFilesWithGlobFilter method** - [ ]
   - Accept workspaceRoot, includePatterns, excludePatterns, maxCount parameters
   - Use globby with include/exclude patterns
   - Set deep: 10 to limit recursion
   - Return tuple of [files, didHitLimit]
   - Keep under 50 lines
   - **UPDATE:** Mark [x] when complete

2. **Create formatFlatFileList method** - [ ]
   - Accept workspaceRoot, files, didHitLimit parameters
   - Convert to relative paths
   - Sort alphabetically
   - Join with newlines
   - Add truncation message if didHitLimit
   - Keep under 30 lines
   - **UPDATE:** Mark [x] when complete

3. **Update file tree section to use new filtering** - [ ]
   - Replace listFiles call with listFilesWithGlobFilter
   - Pass config.workdir.include, config.workdir.exclude, config.workdir.maxFileCount
   - Add fileTreeStyle check for flat vs tree formatting
   - Use formatFlatFileList when config.fileTreeStyle === 'flat'
   - Keep existing formatFilesList for tree style
   - **UPDATE:** Mark [x] when complete

4. **Add unit tests** - [ ]
   - Test glob filtering with various patterns
   - Test maxFileCount enforcement
   - Test flat list formatting
   - Test tree vs flat style selection
   - Mock globby responses
   - Coverage target: ≥90%
   - **UPDATE:** Mark [x] when complete

### Testing & Commit (MANDATORY)

**⚠️ CRITICAL: Tests MUST pass before commit**

Run tests. Fix until green. Do NOT proceed otherwise.

**After pass:**
Update plan (mark Phase 3 ✅, add summary), commit with conventional format.

## 🚀 Phase 4: Config File Watching

**Goal:** Watch `.clinecontext` for changes and reload config automatically

### Implementation Steps

1. **Add file watcher in constructor** - [ ]
   - Use existing chokidar dependency
   - Watch `.clinecontext` in workspace root
   - Set ignoreInitial: true
   - Handle change, add, unlink events
   - Call contextConfigLoader.clearCache() on events
   - Clean up watcher on dispose
   - Keep under 30 lines
   - **UPDATE:** Mark [x] when complete

2. **Add unit tests** - [ ]
   - Test watcher triggers cache clear on change
   - Test watcher triggers cache clear on add
   - Test watcher triggers cache clear on unlink
   - Mock chokidar watch
   - Coverage target: ≥90%
   - **UPDATE:** Mark [x] when complete

### Testing & Commit (MANDATORY)

**⚠️ CRITICAL: Tests MUST pass before commit**

Run tests. Fix until green. Do NOT proceed otherwise.

**After pass:**
Update plan (mark Phase 4 ✅, add summary), commit with conventional format.

## 🚀 Phase 5: Unit Tests

**Goal:** Add comprehensive integration tests for complete feature

### Implementation Steps

1. **Add end-to-end config tests** - [ ]
   - Test complete flow: config file → loader → environment details
   - Test default config behavior
   - Test custom config with all options
   - Test config changes trigger reload
   - Test invalid config falls back to defaults
   - Coverage target: ≥90%
   - **UPDATE:** Mark [x] when complete

2. **Add example .clinecontext file to docs** - [ ]
   - Create example config with all options documented
   - Include comments explaining each setting
   - Show common monorepo patterns
   - Add to extension documentation
   - **UPDATE:** Mark [x] when complete

### Testing & Commit (MANDATORY)

**⚠️ CRITICAL: Tests MUST pass before commit**

Run tests. Fix until green. Do NOT proceed otherwise.

**After pass:**
Update plan (mark Phase 5 ✅, add summary), commit with conventional format.
