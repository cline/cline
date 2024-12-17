import { addLineNumbers, everyLineHasLineNumbers, stripLineNumbers } from '../extract-text';

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

describe('everyLineHasLineNumbers', () => {
    it('should return true for content with line numbers', () => {
        const input = '1 | line one\n2 | line two\n3 | line three';
        expect(everyLineHasLineNumbers(input)).toBe(true);
    });

    it('should return true for content with padded line numbers', () => {
        const input = '  1 | line one\n  2 | line two\n  3 | line three';
        expect(everyLineHasLineNumbers(input)).toBe(true);
    });

    it('should return false for content without line numbers', () => {
        const input = 'line one\nline two\nline three';
        expect(everyLineHasLineNumbers(input)).toBe(false);
    });

    it('should return false for mixed content', () => {
        const input = '1 | line one\nline two\n3 | line three';
        expect(everyLineHasLineNumbers(input)).toBe(false);
    });

    it('should handle empty content', () => {
        expect(everyLineHasLineNumbers('')).toBe(false);
    });

    it('should return false for content with pipe but no line numbers', () => {
        const input = 'a | b\nc | d';
        expect(everyLineHasLineNumbers(input)).toBe(false);
    });
});

describe('stripLineNumbers', () => {
    it('should strip line numbers from content', () => {
        const input = '1 | line one\n2 | line two\n3 | line three';
        const expected = 'line one\nline two\nline three';
        expect(stripLineNumbers(input)).toBe(expected);
    });

    it('should strip padded line numbers', () => {
        const input = '  1 | line one\n  2 | line two\n  3 | line three';
        const expected = 'line one\nline two\nline three';
        expect(stripLineNumbers(input)).toBe(expected);
    });

    it('should handle content without line numbers', () => {
        const input = 'line one\nline two\nline three';
        expect(stripLineNumbers(input)).toBe(input);
    });

    it('should handle empty content', () => {
        expect(stripLineNumbers('')).toBe('');
    });

    it('should preserve content with pipe but no line numbers', () => {
        const input = 'a | b\nc | d';
        expect(stripLineNumbers(input)).toBe(input);
    });

    it('should handle windows-style line endings', () => {
        const input = '1 | line one\r\n2 | line two\r\n3 | line three';
        const expected = 'line one\r\nline two\r\nline three';
        expect(stripLineNumbers(input)).toBe(expected);
    });

    it('should handle content with varying line number widths', () => {
        const input = '  1 | line one\n 10 | line two\n100 | line three';
        const expected = 'line one\nline two\nline three';
        expect(stripLineNumbers(input)).toBe(expected);
    });

    it('should preserve indentation after line numbers', () => {
        const input = '1 |     indented line\n2 |   another indented';
        const expected = '    indented line\n  another indented';
        expect(stripLineNumbers(input)).toBe(expected);
    });
});