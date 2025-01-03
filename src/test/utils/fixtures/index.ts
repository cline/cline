// Test fixtures and data generators
export function generateMockConfig<T>(overrides: Partial<T> = {}): T {
  return {
    ...overrides
  } as T;
}

export function generateRandomString(length: number = 10): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

export function generateMockArray<T>(generator: () => T, count: number = 5): T[] {
  return Array.from({ length: count }, () => generator());
}
