import { addLineNumbers } from '../extract-text';

describe('addLineNumbers', () => {
    it('should add line numbers starting from 1 by default', () => {
        const input = 'line 1\nline 2\nline 3';
        const expected = '1 | line 1\n2 | line 2\n3 | line 3';
        expect(addLineNumbers(input)).toBe(expected);
    });

    it('should add line numbers starting from specified line number', () => {
        const input = 'line 1\nline 2\nline 3';
        const expected = '10 | line 1\n11 | line 2\n12 | line 3';
        expect(addLineNumbers(input, 10)).toBe(expected);
    });

    it('should handle empty content', () => {
        expect(addLineNumbers('')).toBe('1 | ');
        expect(addLineNumbers('', 5)).toBe('5 | ');
    });

    it('should handle single line content', () => {
        expect(addLineNumbers('single line')).toBe('1 | single line');
        expect(addLineNumbers('single line', 42)).toBe('42 | single line');
    });

    it('should pad line numbers based on the highest line number', () => {
        const input = 'line 1\nline 2';
        // When starting from 99, highest line will be 100, so needs 3 spaces padding
        const expected = ' 99 | line 1\n100 | line 2';
        expect(addLineNumbers(input, 99)).toBe(expected);
    });
});