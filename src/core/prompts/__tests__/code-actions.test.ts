import { explainCodePrompt, fixCodePrompt, improveCodePrompt } from '../code-actions';

describe('Code Action Prompts', () => {
    const testFilePath = 'test/file.ts';
    const testCode = 'function test() { return true; }';

    describe('explainCodePrompt', () => {
        it('should format explain prompt correctly', () => {
            const prompt = explainCodePrompt({
                filePath: testFilePath,
                selectedText: testCode
            });
            
            expect(prompt).toContain(`@/${testFilePath}`);
            expect(prompt).toContain(testCode);
            expect(prompt).toContain('purpose and functionality');
            expect(prompt).toContain('Key components');
            expect(prompt).toContain('Important patterns');
        });
    });

    describe('fixCodePrompt', () => {
        it('should format fix prompt without diagnostics', () => {
            const prompt = fixCodePrompt({
                filePath: testFilePath,
                selectedText: testCode
            });
            
            expect(prompt).toContain(`@/${testFilePath}`);
            expect(prompt).toContain(testCode);
            expect(prompt).toContain('Address all detected problems');
            expect(prompt).not.toContain('Current problems detected');
        });

        it('should format fix prompt with diagnostics', () => {
            const diagnostics = [
                {
                    source: 'eslint',
                    message: 'Missing semicolon',
                    code: 'semi'
                },
                {
                    message: 'Unused variable',
                    severity: 1
                }
            ];

            const prompt = fixCodePrompt({
                filePath: testFilePath,
                selectedText: testCode,
                diagnostics
            });
            
            expect(prompt).toContain('Current problems detected:');
            expect(prompt).toContain('[eslint] Missing semicolon (semi)');
            expect(prompt).toContain('[Error] Unused variable');
            expect(prompt).toContain(testCode);
        });
    });

    describe('improveCodePrompt', () => {
        it('should format improve prompt correctly', () => {
            const prompt = improveCodePrompt({
                filePath: testFilePath,
                selectedText: testCode
            });
            
            expect(prompt).toContain(`@/${testFilePath}`);
            expect(prompt).toContain(testCode);
            expect(prompt).toContain('Code readability');
            expect(prompt).toContain('Performance optimization');
            expect(prompt).toContain('Best practices');
            expect(prompt).toContain('Error handling');
        });
    });
});