#!/usr/bin/env python3

"""
Unit tests for version_manager.py

Tests the version bumping logic and changeset handling.
Mock git commands to test different scenarios.
"""

import unittest
from unittest.mock import patch, MagicMock
import tempfile
import os
import json
from version_manager import (
    get_last_release_tag,
    get_changesets_since_tag,
    determine_version_bump,
    bump_version,
    parse_args
)

class TestVersionManager(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for test changesets
        self.temp_dir = tempfile.mkdtemp()
        
    def create_changeset_file(self, content: str) -> str:
        """Helper to create a test changeset file."""
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.md',
            dir=self.temp_dir,
            delete=False
        ) as f:
            f.write(content)
            return f.name
    
    @patch('subprocess.check_output')
    def test_get_last_release_tag_no_tags(self, mock_check_output):
        mock_check_output.return_value = "".encode()
        tag, is_pre = get_last_release_tag()
        self.assertEqual(tag, "v0.0.0")
        self.assertFalse(is_pre)
    
    @patch('subprocess.check_output')
    def test_get_last_release_tag_with_pre(self, mock_check_output):
        mock_check_output.return_value = """v3.2.1-pre
v3.2.0
v3.1.0""".encode()
        
        # When including pre-releases
        tag, is_pre = get_last_release_tag(include_pre=True)
        self.assertEqual(tag, "v3.2.1-pre")
        self.assertTrue(is_pre)
        
        # When excluding pre-releases
        tag, is_pre = get_last_release_tag(include_pre=False)
        self.assertEqual(tag, "v3.2.0")
        self.assertFalse(is_pre)
    
    def test_determine_version_bump(self):
        # Test major change
        changesets = [{"type": "major"}, {"type": "minor"}, {"type": "patch"}]
        bump_type, count = determine_version_bump(changesets)
        self.assertEqual(bump_type, "major")
        self.assertEqual(count, 3)
        
        # Test minor change
        changesets = [{"type": "minor"}, {"type": "patch"}]
        bump_type, count = determine_version_bump(changesets)
        self.assertEqual(bump_type, "minor")
        self.assertEqual(count, 2)
        
        # Test patch change
        changesets = [{"type": "patch"}]
        bump_type, count = determine_version_bump(changesets)
        self.assertEqual(bump_type, "patch")
        self.assertEqual(count, 1)
        
        # Test no changes
        changesets = []
        bump_type, count = determine_version_bump(changesets)
        self.assertEqual(bump_type, "patch")
        self.assertEqual(count, 0)
    
    def test_bump_version(self):
        # Test major bump
        self.assertEqual(bump_version("v1.2.3", "major"), "v2.0.0")
        
        # Test minor bump
        self.assertEqual(bump_version("v1.2.3", "minor"), "v1.3.0")
        
        # Test patch bump
        self.assertEqual(bump_version("v1.2.3", "patch"), "v1.2.4")
        
        # Test without v prefix
        self.assertEqual(bump_version("1.2.3", "minor"), "v1.3.0")
    
    @patch('subprocess.check_output')
    def test_get_changesets_since_tag(self, mock_check_output):
        # Create test changeset files
        major_change = self.create_changeset_file("""---
major
Added new feature X that changes the API""")
        
        minor_change = self.create_changeset_file("""---
minor
Added new helper function""")
        
        patch_change = self.create_changeset_file("""---
patch
Fixed bug in error handling""")
        
        # Mock git diff to return our test files
        mock_check_output.return_value = "\n".join([
            major_change,
            minor_change,
            patch_change
        ]).encode()
        
        changesets = get_changesets_since_tag("v1.0.0")
        
        self.assertEqual(len(changesets), 3)
        self.assertEqual(changesets[0]["type"], "major")
        self.assertEqual(changesets[1]["type"], "minor")
        self.assertEqual(changesets[2]["type"], "patch")
    
    def test_parse_args(self):
        with patch('sys.argv', ['script.py', '--release-type', 'pre-release']):
            args = parse_args()
            self.assertEqual(args.release_type, "pre-release")
        
        with patch('sys.argv', ['script.py']):
            args = parse_args()
            self.assertEqual(args.release_type, "release")  # default value

if __name__ == '__main__':
    unittest.main()
