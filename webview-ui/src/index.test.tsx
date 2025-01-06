import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import App from './App';



describe('Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('renders index.tsx without crashing', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    require('./index');

    // Structural check: Verify that the div is present in the document
    expect(document.body.contains(div)).toBe(true);
  });

  it('renders App component', () => {
    const { container } = render(<App />);
    expect(container).toBeDefined();
  });
});
