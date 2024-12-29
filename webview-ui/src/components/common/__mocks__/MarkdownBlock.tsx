import * as React from 'react';

interface MarkdownBlockProps {
  children?: React.ReactNode;
  content?: string;
}

const MarkdownBlock: React.FC<MarkdownBlockProps> = ({ content }) => (
  <div data-testid="mock-markdown-block">{content}</div>
);

export default MarkdownBlock;