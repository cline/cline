import { describe, it, expect, vi } from 'vitest';
import { normalizePath } from './path';

describe('Path Utility', () => {
  it('should normalize Windows path', () => {
    const testPath = 'C:\\Users\\Test\\Documents';
    const normalizedPath = normalizePath(testPath);
    
    expect(normalizedPath).toBe('C:/Users/Test/Documents');
  });

  it('should handle already normalized paths', () => {
    const testPath = 'C:/Users/Test/Documents';
    const normalizedPath = normalizePath(testPath);
    
    expect(normalizedPath).toBe('C:/Users/Test/Documents');
  });

  it('should handle mixed path separators', () => {
    const testPath = 'C:\\Users/Test\\Documents';
    const normalizedPath = normalizePath(testPath);
    
    expect(normalizedPath).toBe('C:/Users/Test/Documents');
  });
});
