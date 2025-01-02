import { vi } from 'vitest';

/**
 * Create a mock function with optional implementation
 * @param implementation Optional mock implementation
 * @returns Mocked function
 */
export function createMockFunction<T extends (...args: any[]) => any>(
  implementation?: T
): jest.MockedFunction<T> {
  return vi.fn(implementation);
}

/**
 * Create a mock object with mocked methods
 * @param methods Object with method names to mock
 * @returns Object with mocked methods
 */
export function createMockObject<T extends Record<string, (...args: any[]) => any>>(
  methods: T
): { [K in keyof T]: jest.MockedFunction<T[K]> } {
  const mockedObject: any = {};
  
  for (const [key, method] of Object.entries(methods)) {
    mockedObject[key] = vi.fn(method);
  }
  
  return mockedObject;
}

/**
 * Generate random test data
 */
export const testData = {
  /**
   * Generate a random string
   * @param length Length of the string, default 10
   * @returns Random string
   */
  randomString: (length = 10) => 
    Math.random().toString(36).substring(2, length + 2),
  
  /**
   * Generate a random number within a range
   * @param min Minimum value, default 0
   * @param max Maximum value, default 100
   * @returns Random number
   */
  randomNumber: (min = 0, max = 100) => 
    Math.floor(Math.random() * (max - min + 1)) + min,
  
  /**
   * Generate a random boolean
   * @returns Random boolean
   */
  randomBoolean: () => Math.random() < 0.5,

  /**
   * Generate a random date
   * @param start Start date, default 1 year ago
   * @param end End date, default now
   * @returns Random date
   */
  randomDate: (start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), end = new Date()) => {
    const startTime = start.getTime();
    const endTime = end.getTime();
    return new Date(startTime + Math.random() * (endTime - startTime));
  }
};

/**
 * Async utility to simulate network or async operation delay
 * @param ms Milliseconds to delay
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a spy that tracks method calls
 * @param object Object containing the method
 * @param methodName Name of the method to spy on
 * @returns Spy object
 */
export function createSpy<T extends object, K extends keyof T>(
  object: T, 
  methodName: K
): jest.MockedFunction<T[K]> {
  return vi.spyOn(object, methodName as any);
}

/**
 * Check if a mock function was called with specific arguments
 * @param mockFn Mock function to check
 * @param args Expected arguments
 * @returns Boolean indicating if the function was called with those arguments
 */
export function wasCalledWith(mockFn: jest.MockedFunction<any>, ...args: any[]): boolean {
  return mockFn.mock.calls.some(call => 
    call.every((arg, index) => arg === args[index])
  );
}
