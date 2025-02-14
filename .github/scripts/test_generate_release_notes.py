#!/usr/bin/env python3

"""
Unit tests for generate_release_notes.py

Tests the release notes generation logic and OpenRouter API integration.
Mock API responses to test different scenarios.
"""

import unittest
from unittest.mock import patch, MagicMock
import json
import os
from generate_release_notes import (
    parse_args,
    generate_prompt,
    generate_release_notes
)

class TestGenerateReleaseNotes(unittest.TestCase):
    def setUp(self):
        self.sample_changesets = [
            {
                "type": "major",
                "content": "Added new browser automation feature"
            },
            {
                "type": "minor",
                "content": "Added support for custom themes"
            },
            {
                "type": "patch",
                "content": "Fixed issue with file watching"
            }
        ]
        
        self.sample_git_info = {
            "commit_log": "abc123 Add browser feature\ndef456 Add themes",
            "diff_stats": "5 files changed, 200 insertions(+), 50 deletions(-)",
            "last_tag": "v3.2.0"
        }
    
    def test_parse_args(self):
        with patch('sys.argv', [
            'script.py',
            '--release-type', 'pre-release',
            '--version', 'v3.3.0',
            '--changesets', json.dumps(self.sample_changesets)
        ]):
            args = parse_args()
            self.assertEqual(args.release_type, "pre-release")
            self.assertEqual(args.version, "v3.3.0")
            self.assertEqual(
                json.loads(args.changesets),
                self.sample_changesets
            )
    
    def test_generate_prompt(self):
        prompt = generate_prompt(
            self.sample_changesets,
            self.sample_git_info,
            "v3.3.0",
            True  # is_prerelease
        )
        
        # Check that prompt contains key elements
        self.assertIn("v3.3.0 (Pre-release)", prompt)
        self.assertIn("Major Changes:", prompt)
        self.assertIn("Added new browser automation feature", prompt)
        self.assertIn("Minor Changes:", prompt)
        self.assertIn("Added support for custom themes", prompt)
        self.assertIn("Patch Changes:", prompt)
        self.assertIn("Fixed issue with file watching", prompt)
        
        # Check git info inclusion
        self.assertIn("abc123 Add browser feature", prompt)
        self.assertIn("5 files changed", prompt)
    
    @patch('requests.post')
    def test_generate_release_notes_success(self, mock_post):
        # Mock successful API response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": """## Browser Automation and Theme Support

This release introduces powerful browser automation capabilities and customizable themes, along with various improvements and fixes.

### 🚀 New Features & Improvements
- Added browser automation for enhanced testing and debugging
- Introduced support for custom themes

### 🐛 Bugs Fixed
- Resolved file watching reliability issues"""
                }
            }]
        }
        mock_post.return_value = mock_response
        
        # Set environment variable for testing
        os.environ["OPENROUTER_API_KEY"] = "test-key"
        
        result = generate_release_notes("Test prompt")
        self.assertIn("## Browser Automation", result)
        self.assertIn("🚀 New Features", result)
        self.assertIn("🐛 Bugs Fixed", result)
    
    @patch('requests.post')
    def test_generate_release_notes_api_error(self, mock_post):
        # Mock API error
        mock_post.side_effect = Exception("API Error")
        
        result = generate_release_notes("Test prompt")
        self.assertIsNone(result)
    
    def test_generate_release_notes_no_api_key(self):
        # Remove API key from environment
        if "OPENROUTER_API_KEY" in os.environ:
            del os.environ["OPENROUTER_API_KEY"]
        
        result = generate_release_notes("Test prompt")
        self.assertIsNone(result)

if __name__ == '__main__':
    unittest.main()
