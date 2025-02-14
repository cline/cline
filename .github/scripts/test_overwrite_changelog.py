#!/usr/bin/env python3

"""
Unit tests for overwrite_changeset_changelog.py

Tests the changelog updating functionality with various scenarios.
"""

import unittest
import tempfile
import os
from overwrite_changeset_changelog import (
    parse_args,
    update_changelog
)

class TestOverwriteChangelog(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for test files
        self.temp_dir = tempfile.mkdtemp()
        
        # Sample release notes content
        self.release_notes = """## Browser Automation and Theme Support

This release introduces powerful browser automation capabilities and customizable themes.

### 🚀 New Features & Improvements
- Added browser automation for enhanced testing and debugging
- Introduced support for custom themes

### 🐛 Bugs Fixed
- Resolved file watching reliability issues"""
    
    def create_changelog(self, content: str) -> str:
        """Helper to create a test changelog file."""
        path = os.path.join(self.temp_dir, "CHANGELOG.md")
        with open(path, "w") as f:
            f.write(content)
        return path
    
    def test_parse_args(self):
        with unittest.mock.patch('sys.argv', [
            'script.py',
            '--version', 'v3.3.0',
            '--content', self.release_notes,
            '--changelog-path', 'test.md'
        ]):
            args = parse_args()
            self.assertEqual(args.version, "v3.3.0")
            self.assertEqual(args.content, self.release_notes)
            self.assertEqual(args.changelog_path, "test.md")
    
    def test_update_empty_changelog(self):
        """Test updating a non-existent or empty changelog."""
        changelog_path = os.path.join(self.temp_dir, "empty.md")
        
        update_changelog("v3.3.0", self.release_notes, changelog_path)
        
        with open(changelog_path, "r") as f:
            content = f.read()
        
        self.assertIn("# Changelog", content)
        self.assertIn("## [v3.3.0]", content)
        self.assertIn("Browser Automation and Theme Support", content)
    
    def test_update_existing_changelog(self):
        """Test updating an existing changelog with content."""
        existing_content = """# Changelog

## [v3.2.0]

Previous release notes here.
"""
        changelog_path = self.create_changelog(existing_content)
        
        update_changelog("v3.3.0", self.release_notes, changelog_path)
        
        with open(changelog_path, "r") as f:
            content = f.read()
        
        # Check that new content is at the top
        self.assertTrue(content.index("## [v3.3.0]") < content.index("## [v3.2.0]"))
        self.assertIn("Browser Automation and Theme Support", content)
        self.assertIn("Previous release notes here", content)
    
    def test_update_malformed_changelog(self):
        """Test updating a malformed changelog."""
        malformed_content = """Some random content
without proper headers
or formatting"""
        changelog_path = self.create_changelog(malformed_content)
        
        update_changelog("v3.3.0", self.release_notes, changelog_path)
        
        with open(changelog_path, "r") as f:
            content = f.read()
        
        # Should prepend proper headers
        self.assertTrue(content.startswith("# Changelog"))
        self.assertIn("## [v3.3.0]", content)
        self.assertIn("Browser Automation and Theme Support", content)
        self.assertIn("Some random content", content)
    
    def test_file_not_found(self):
        """Test handling of non-existent changelog file."""
        non_existent_path = os.path.join(self.temp_dir, "nonexistent.md")
        
        update_changelog("v3.3.0", self.release_notes, non_existent_path)
        
        # Should create the file
        self.assertTrue(os.path.exists(non_existent_path))
        with open(non_existent_path, "r") as f:
            content = f.read()
        self.assertIn("# Changelog", content)
        self.assertIn("## [v3.3.0]", content)
    
    def tearDown(self):
        # Clean up temporary files
        for root, dirs, files in os.walk(self.temp_dir):
            for file in files:
                os.remove(os.path.join(root, file))
        os.rmdir(self.temp_dir)

if __name__ == '__main__':
    unittest.main()
