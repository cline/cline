// Mock utilities for testing
interface VSCodeExtensionMode {
  Development: number;
  Production: number;
  Test: number;
}

interface VSCodeExtensionContext {
  subscriptions: any[];
  extensionMode: number;
}

const VSCodeExtensionMode: VSCodeExtensionMode = {
  Development: 1,
  Production: 2,
  Test: 3
};

export function createMockVSCodeContext(): VSCodeExtensionContext {
  return {
    subscriptions: [],
    extensionMode: VSCodeExtensionMode.Development
  };
}

export function createMockVSCodeCommand() {
  return {
    title: 'Mock Command',
    command: 'mock.command'
  };
}
