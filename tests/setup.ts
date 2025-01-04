import { vi, beforeEach, afterEach } from 'vitest';
import './vscode-mocks';

// Global test setup
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetModules();
});

// Helper functions for testing
export const waitForNextTick = () => new Promise(resolve => process.nextTick(resolve));

export const createMockTextDocument = (content: string = '', language: string = 'typescript') => ({
  getText: vi.fn().mockReturnValue(content),
  languageId: language,
  version: 1,
  uri: { scheme: 'file', path: '/test/file.ts' },
  lineAt: vi.fn(line => ({
    text: content.split('\n')[line] || '',
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
  })),
  lineCount: content.split('\n').length,
});

export const createMockTextEditor = (document = createMockTextDocument()) => ({
  document,
  selection: {
    active: { line: 0, character: 0 },
    anchor: { line: 0, character: 0 },
  },
  edit: vi.fn(),
  insertSnippet: vi.fn(),
  revealRange: vi.fn(),
});
