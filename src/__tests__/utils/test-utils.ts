import { Spy } from 'jasmine';

/**
 * Create a mock function with optional implementation
 * @param implementation Optional mock implementation
 * @returns Mocked function
 */
export function createMockFunction<T extends (...args: any[]) => any>(
  implementation?: T
): Spy {
  return jasmine.createSpy('mockFunction', implementation);
}

/**
 * Create a mock object with mocked methods
 * @param methods Object with method names to mock
 * @returns Object with mocked methods
 */
export function createMockObject<T extends Record<string, (...args: any[]) => any>>(
  methods: T
): { [K in keyof T]: Spy } {
  const mockedObject: Partial<{ [K in keyof T]: Spy }> = {};
  
  for (const key of Object.keys(methods) as Array<keyof T>) {
    mockedObject[key] = jasmine.createSpy(String(key), methods[key]);
  }
  
  return mockedObject as { [K in keyof T]: Spy };
}

/**
 * Generate random test data
 */
export const testData = {
  randomString: (length = 10) => Math.random().toString(36).substring(2, length + 2),
  randomNumber: (min = 0, max = 100) => Math.floor(Math.random() * (max - min + 1)) + min,
  randomBoolean: () => Math.random() < 0.5,
  randomDate: (
    start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    end = new Date()
  ) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())),
};

/**
 * Async utility to simulate network or async operation delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a spy on an object method
 */
export function createSpy<T extends object, K extends keyof T>(
  object: T,
  methodName: K
): Spy {
  const method = object[methodName];
  if (typeof method !== 'function') {
    throw new Error(`Property ${String(methodName)} is not a function`);
  }
  return jasmine.createSpy('spy', method as (...args: any[]) => any);
}

/**
 * Check if a spy was called with specific arguments
 */
export function wasCalledWith(spy: Spy, ...args: any[]): boolean {
  return spy.calls.allArgs().some((callArgs: any[]) => 
    callArgs.length === args.length && 
    callArgs.every((arg: any, index: number) => arg === args[index])
  );
}
