// Mock VSCode types
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

import { 
  createMockVSCodeContext, 
  generateRandomString, 
  suppressConsoleErrors 
} from './utils';

describe('Sample Test Suite', () => {
  // Use the new test utilities
  const mockContext = createMockVSCodeContext();

  suppressConsoleErrors();

  it('should create a mock VSCode context', () => {
    expect(mockContext).toBeTruthy();
    expect(mockContext.extensionMode).toBe(VSCodeExtensionMode.Development);
  });

  it('should generate a random string', () => {
    const randomString = generateRandomString(10);
    expect(randomString).toBeTruthy();
    expect(randomString.length).toBe(10);
  });

  it('should handle async expectations', async () => {
    const asyncTest = Promise.resolve('test');
    await expectAsync(asyncTest).toBeResolved();
  });
});
