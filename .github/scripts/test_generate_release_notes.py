#!/usr/bin/env python3

import os
import unittest
from unittest.mock import patch, MagicMock
import json
from generate_release_notes import generate_release_notes, generate_prompt, parse_args

class TestGenerateReleaseNotes(unittest.TestCase):
    def setUp(self):
        self.test_changesets = [
            {
                "type": "minor",
                "content": "Added new feature"
            },
            {
                "type": "patch",
                "content": "Fixed bug"
            }
        ]
        
        self.test_git_info = {
            "commit_log": "test commit",
            "diff_stats": "1 file changed",
            "last_tag": "v3.2.0"
        }
        
        self.test_version = "v3.3.0"
    
    def test_parse_args(self):
        with patch('sys.argv', ['script.py',
            '--changesets', json.dumps(self.test_changesets),
            '--version', self.test_version,
            '--release-type', 'release',
            '--api-key', 'test-api-key'
        ]):
            args = parse_args()
            self.assertEqual(args.changesets, json.dumps(self.test_changesets))
            self.assertEqual(args.version, self.test_version)
            self.assertEqual(args.release_type, 'release')
            self.assertEqual(args.api_key, 'test-api-key')
    
    def test_generate_prompt(self):
        # Test regular release prompt
        prompt = generate_prompt(
            self.test_changesets,
            self.test_git_info,
            self.test_version,
            is_prerelease=False
        )
        
        self.assertIn(self.test_version, prompt)
        self.assertIn("Added new feature", prompt)
        self.assertIn("Fixed bug", prompt)
        self.assertIn("test commit", prompt)
        self.assertIn("1 file changed", prompt)
        self.assertNotIn("(Pre-release)", prompt)
        
        # Test pre-release prompt
        pre_version = f"{self.test_version}-pre"
        pre_prompt = generate_prompt(
            self.test_changesets,
            self.test_git_info,
            pre_version,
            is_prerelease=True
        )
        
        self.assertIn(pre_version, pre_prompt)
        self.assertIn("(Pre-release)", pre_prompt)
        self.assertIn("Added new feature", pre_prompt)
        self.assertIn("Fixed bug", pre_prompt)
    
    @patch('requests.post')
    def test_generate_release_notes_success(self, mock_post):
        # Test regular release notes
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": "Test release notes"
                }
            }]
        }
        mock_post.return_value = mock_response
        
        prompt = generate_prompt(
            self.test_changesets,
            self.test_git_info,
            self.test_version,
            is_prerelease=False
        )
        
        result = generate_release_notes(prompt, api_key="mock-api-key")
        self.assertEqual(result, "Test release notes")
        
        # Test pre-release notes
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": "Test pre-release notes"
                }
            }]
        }
        mock_post.return_value = mock_response
        
        pre_prompt = generate_prompt(
            self.test_changesets,
            self.test_git_info,
            f"{self.test_version}-pre",
            is_prerelease=True
        )
        
        pre_result = generate_release_notes(pre_prompt, api_key="mock-api-key")
        self.assertEqual(pre_result, "Test pre-release notes")
    
    def test_generate_release_notes_no_api_key(self):
        prompt = generate_prompt(
            self.test_changesets,
            self.test_git_info,
            self.test_version,
            is_prerelease=False
        )
        
        with self.assertRaises(Exception) as context:
            generate_release_notes(prompt)
        self.assertIn("API key not provided", str(context.exception))
    
    @patch('requests.post')
    def test_generate_release_notes_api_error(self, mock_post):
        # Mock API error
        mock_post.side_effect = Exception("API Error")
        
        prompt = generate_prompt(
            self.test_changesets,
            self.test_git_info,
            self.test_version,
            is_prerelease=False
        )
        
        with self.assertRaises(Exception) as context:
            generate_release_notes(prompt, api_key="mock-api-key")
        self.assertIn("API Error", str(context.exception))

if __name__ == '__main__':
    unittest.main()
