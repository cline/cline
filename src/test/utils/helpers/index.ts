// Test helper utilities
export function expectAsync<T>(promise: Promise<T>): jasmine.AsyncMatchers<T, any> {
  return expectAsync(promise);
}

export function suppressConsoleErrors() {
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = jasmine.createSpy('error').and.callFake((...args) => {
      // Optionally log or handle errors silently
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });
}

export function measurePerformance(fn: () => void, iterations: number = 1000): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  return (end - start) / iterations;
}
