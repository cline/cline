import { arePathsEqual, getReadablePath } from '../path';
import * as path from 'path';
import os from 'os';

describe('Path Utilities', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform
        });
    });

    describe('String.prototype.toPosix', () => {
        it('should convert backslashes to forward slashes', () => {
            const windowsPath = 'C:\\Users\\test\\file.txt';
            expect(windowsPath.toPosix()).toBe('C:/Users/test/file.txt');
        });

        it('should not modify paths with forward slashes', () => {
            const unixPath = '/home/user/file.txt';
            expect(unixPath.toPosix()).toBe('/home/user/file.txt');
        });

        it('should preserve extended-length Windows paths', () => {
            const extendedPath = '\\\\?\\C:\\Very\\Long\\Path';
            expect(extendedPath.toPosix()).toBe('\\\\?\\C:\\Very\\Long\\Path');
        });
    });

    describe('arePathsEqual', () => {
        describe('on Windows', () => {
            beforeEach(() => {
                Object.defineProperty(process, 'platform', {
                    value: 'win32'
                });
            });

            it('should compare paths case-insensitively', () => {
                expect(arePathsEqual('C:\\Users\\Test', 'c:\\users\\test')).toBe(true);
            });

            it('should handle different path separators', () => {
                // Convert both paths to use forward slashes after normalization
                const path1 = path.normalize('C:\\Users\\Test').replace(/\\/g, '/');
                const path2 = path.normalize('C:/Users/Test').replace(/\\/g, '/');
                expect(arePathsEqual(path1, path2)).toBe(true);
            });

            it('should normalize paths with ../', () => {
                // Convert both paths to use forward slashes after normalization
                const path1 = path.normalize('C:\\Users\\Test\\..\\Test').replace(/\\/g, '/');
                const path2 = path.normalize('C:\\Users\\Test').replace(/\\/g, '/');
                expect(arePathsEqual(path1, path2)).toBe(true);
            });
        });

        describe('on POSIX', () => {
            beforeEach(() => {
                Object.defineProperty(process, 'platform', {
                    value: 'darwin'
                });
            });

            it('should compare paths case-sensitively', () => {
                expect(arePathsEqual('/Users/Test', '/Users/test')).toBe(false);
            });

            it('should normalize paths', () => {
                expect(arePathsEqual('/Users/./Test', '/Users/Test')).toBe(true);
            });

            it('should handle trailing slashes', () => {
                expect(arePathsEqual('/Users/Test/', '/Users/Test')).toBe(true);
            });
        });

        describe('edge cases', () => {
            it('should handle undefined paths', () => {
                expect(arePathsEqual(undefined, undefined)).toBe(true);
                expect(arePathsEqual('/test', undefined)).toBe(false);
                expect(arePathsEqual(undefined, '/test')).toBe(false);
            });

            it('should handle root paths with trailing slashes', () => {
                expect(arePathsEqual('/', '/')).toBe(true);
                expect(arePathsEqual('C:\\', 'C:\\')).toBe(true);
            });
        });
    });

    describe('getReadablePath', () => {
        const homeDir = os.homedir();
        const desktop = path.join(homeDir, 'Desktop');

        it('should return basename when path equals cwd', () => {
            const cwd = '/Users/test/project';
            expect(getReadablePath(cwd, cwd)).toBe('project');
        });

        it('should return relative path when inside cwd', () => {
            const cwd = '/Users/test/project';
            const filePath = '/Users/test/project/src/file.txt';
            expect(getReadablePath(cwd, filePath)).toBe('src/file.txt');
        });

        it('should return absolute path when outside cwd', () => {
            const cwd = '/Users/test/project';
            const filePath = '/Users/test/other/file.txt';
            expect(getReadablePath(cwd, filePath)).toBe('/Users/test/other/file.txt');
        });

        it('should handle Desktop as cwd', () => {
            const filePath = path.join(desktop, 'file.txt');
            expect(getReadablePath(desktop, filePath)).toBe(filePath.toPosix());
        });

        it('should handle undefined relative path', () => {
            const cwd = '/Users/test/project';
            expect(getReadablePath(cwd)).toBe('project');
        });

        it('should handle parent directory traversal', () => {
            const cwd = '/Users/test/project';
            const filePath = '../../other/file.txt';
            expect(getReadablePath(cwd, filePath)).toBe('/Users/other/file.txt');
        });

        it('should normalize paths with redundant segments', () => {
            const cwd = '/Users/test/project';
            const filePath = '/Users/test/project/./src/../src/file.txt';
            expect(getReadablePath(cwd, filePath)).toBe('src/file.txt');
        });
    });
});