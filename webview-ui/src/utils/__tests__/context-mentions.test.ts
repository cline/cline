import { insertMention, removeMention, getContextMenuOptions, shouldShowContextMenu, ContextMenuOptionType, ContextMenuQueryItem } from '../context-mentions'

describe('insertMention', () => {
	it('should insert mention at cursor position when no @ symbol exists', () => {
		const result = insertMention('Hello world', 5, 'test')
		expect(result.newValue).toBe('Hello@test  world')
		expect(result.mentionIndex).toBe(5)
	})

	it('should replace text after last @ symbol', () => {
		const result = insertMention('Hello @wor world', 8, 'test')
		expect(result.newValue).toBe('Hello @test  world')
		expect(result.mentionIndex).toBe(6)
	})

	it('should handle empty text', () => {
		const result = insertMention('', 0, 'test')
		expect(result.newValue).toBe('@test ')
		expect(result.mentionIndex).toBe(0)
	})
})

describe('removeMention', () => {
	it('should remove mention when cursor is at end of mention', () => {
		// Test with the problems keyword that matches the regex
		const result = removeMention('Hello @problems ', 15)
		expect(result.newText).toBe('Hello ')
		expect(result.newPosition).toBe(6)
	})

	it('should not remove text when not at end of mention', () => {
		const result = removeMention('Hello @test world', 8)
		expect(result.newText).toBe('Hello @test world')
		expect(result.newPosition).toBe(8)
	})

	it('should handle text without mentions', () => {
		const result = removeMention('Hello world', 5)
		expect(result.newText).toBe('Hello world')
		expect(result.newPosition).toBe(5)
	})
})

describe('getContextMenuOptions', () => {
	const mockQueryItems: ContextMenuQueryItem[] = [
		{
			type: ContextMenuOptionType.File,
			value: 'src/test.ts',
			label: 'test.ts',
			description: 'Source file'
		},
		{
			type: ContextMenuOptionType.Git,
			value: 'abc1234',
			label: 'Initial commit',
			description: 'First commit',
			icon: '$(git-commit)'
		},
		{
			type: ContextMenuOptionType.Folder,
			value: 'src',
			label: 'src',
			description: 'Source folder'
		}
	]

	it('should return all option types for empty query', () => {
		const result = getContextMenuOptions('', null, [])
		expect(result).toHaveLength(5)
		expect(result.map(item => item.type)).toEqual([
			ContextMenuOptionType.Problems,
			ContextMenuOptionType.URL,
			ContextMenuOptionType.Folder,
			ContextMenuOptionType.File,
			ContextMenuOptionType.Git
		])
	})

	it('should filter by selected type when query is empty', () => {
		const result = getContextMenuOptions('', ContextMenuOptionType.File, mockQueryItems)
		expect(result).toHaveLength(1)
		expect(result[0].type).toBe(ContextMenuOptionType.File)
		expect(result[0].value).toBe('src/test.ts')
	})

	it('should match git commands', () => {
		const result = getContextMenuOptions('git', null, mockQueryItems)
		expect(result[0].type).toBe(ContextMenuOptionType.Git)
		expect(result[0].label).toBe('Git Commits')
	})

	it('should match git commit hashes', () => {
		const result = getContextMenuOptions('abc1234', null, mockQueryItems)
		expect(result[0].type).toBe(ContextMenuOptionType.Git)
		expect(result[0].value).toBe('abc1234')
	})

	it('should return NoResults when no matches found', () => {
		const result = getContextMenuOptions('nonexistent', null, mockQueryItems)
		expect(result).toHaveLength(1)
		expect(result[0].type).toBe(ContextMenuOptionType.NoResults)
	})
})

describe('shouldShowContextMenu', () => {
	it('should return true for @ symbol', () => {
		expect(shouldShowContextMenu('@', 1)).toBe(true)
	})

	it('should return true for @ followed by text', () => {
		expect(shouldShowContextMenu('Hello @test', 10)).toBe(true)
	})

	it('should return false when no @ symbol exists', () => {
		expect(shouldShowContextMenu('Hello world', 5)).toBe(false)
	})

	it('should return false for @ followed by whitespace', () => {
		expect(shouldShowContextMenu('Hello @ world', 6)).toBe(false)
	})

	it('should return false for @ in URL', () => {
		expect(shouldShowContextMenu('Hello @http://test.com', 17)).toBe(false)
	})

	it('should return false for @problems', () => {
		// Position cursor at the end to test the full word
		expect(shouldShowContextMenu('@problems', 9)).toBe(false)
	})
})