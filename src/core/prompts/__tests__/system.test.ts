import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { addCustomInstructions } from '../system'

// Mock external dependencies
jest.mock('os-name', () => () => 'macOS')
jest.mock('default-shell', () => '/bin/zsh')
jest.mock('os', () => ({
  homedir: () => '/Users/test',
  ...jest.requireActual('os')
}))

describe('system.ts', () => {
  let tempDir: string

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cline-test-'))
  })

  afterEach(async () => {
    // Clean up temporary directory after each test
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('addCustomInstructions', () => {
    it('should include content from .clinerules and .cursorrules if present', async () => {
      // Create test rule files
      await fs.writeFile(path.join(tempDir, '.clinerules'), 'Always write tests\nUse TypeScript')
      await fs.writeFile(path.join(tempDir, '.cursorrules'), 'Format code before committing')

      const customInstructions = 'Base instructions'
      const result = await addCustomInstructions(customInstructions, tempDir)

      // Verify all instructions are included
      expect(result).toContain('Base instructions')
      expect(result).toContain('Always write tests')
      expect(result).toContain('Use TypeScript')
      expect(result).toContain('Format code before committing')
      expect(result).toContain('Rules from .clinerules:')
      expect(result).toContain('Rules from .cursorrules:')
    })

    it('should handle missing rule files gracefully', async () => {
      const customInstructions = 'Base instructions'
      const result = await addCustomInstructions(customInstructions, tempDir)

      // Should only contain base instructions
      expect(result).toContain('Base instructions')
      expect(result).not.toContain('Rules from')
    })

    it('should handle empty rule files', async () => {
      // Create empty rule files
      await fs.writeFile(path.join(tempDir, '.clinerules'), '')
      await fs.writeFile(path.join(tempDir, '.cursorrules'), '')

      const customInstructions = 'Base instructions'
      const result = await addCustomInstructions(customInstructions, tempDir)

      // Should only contain base instructions
      expect(result).toContain('Base instructions')
      expect(result).not.toContain('Rules from')
    })

    it('should handle whitespace-only rule files', async () => {
      // Create rule files with only whitespace
      await fs.writeFile(path.join(tempDir, '.clinerules'), '  \n  \t  ')
      await fs.writeFile(path.join(tempDir, '.cursorrules'), ' \n ')

      const customInstructions = 'Base instructions'
      const result = await addCustomInstructions(customInstructions, tempDir)

      // Should only contain base instructions
      expect(result).toContain('Base instructions')
      expect(result).not.toContain('Rules from')
    })

    it('should handle one rule file present and one missing', async () => {
      // Create only .clinerules
      await fs.writeFile(path.join(tempDir, '.clinerules'), 'Always write tests')

      const customInstructions = 'Base instructions'
      const result = await addCustomInstructions(customInstructions, tempDir)

      // Should contain base instructions and .clinerules content
      expect(result).toContain('Base instructions')
      expect(result).toContain('Always write tests')
      expect(result).toContain('Rules from .clinerules:')
      expect(result).not.toContain('Rules from .cursorrules:')
    })

    it('should handle empty custom instructions with rule files', async () => {
      await fs.writeFile(path.join(tempDir, '.clinerules'), 'Always write tests')
      await fs.writeFile(path.join(tempDir, '.cursorrules'), 'Format code before committing')

      const result = await addCustomInstructions('', tempDir)

      // Should contain rule file content even with empty custom instructions
      expect(result).toContain('Always write tests')
      expect(result).toContain('Format code before committing')
      expect(result).toContain('Rules from .clinerules:')
      expect(result).toContain('Rules from .cursorrules:')
    })

    it('should return empty string when no instructions or rules exist', async () => {
      const result = await addCustomInstructions('', tempDir)
      expect(result).toBe('')
    })
  })
})
