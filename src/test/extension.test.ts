import * as vscode from 'vscode';
import { describe, beforeAll, test, expect } from '@jest/globals';

jest.mock('vscode', () => ({
  window: {
    showInformationMessage: jest.fn(),
  },
}));

describe('Extension Test Suite', () => {
	beforeAll(() => {
		vscode.window.showInformationMessage('Start all tests.');
	});

	test('Sample test', () => {
		expect([1, 2, 3].indexOf(5)).toBe(-1);
		expect([1, 2, 3].indexOf(0)).toBe(-1);
	});

	test('vscode.window.showInformationMessage', () => {
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Start all tests.');
	});
});
