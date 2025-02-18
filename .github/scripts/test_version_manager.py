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
    parse_args,
    overwrite_package_version
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
        # Test with both pre-release and regular releases
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
        
        # Test with only pre-releases
        mock_check_output.return_value = """v3.2.1-pre
v3.2.0-pre""".encode()
        
        # Should still find pre-release when requested
        tag, is_pre = get_last_release_tag(include_pre=True)
        self.assertEqual(tag, "v3.2.1-pre")
        self.assertTrue(is_pre)
        
        # Should return v0.0.0 when no regular releases exist
        tag, is_pre = get_last_release_tag(include_pre=False)
        self.assertEqual(tag, "v0.0.0")
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
        
        # Test with pre-release tag
        self.assertEqual(bump_version("v1.2.3-pre", "minor"), "v1.3.0")
    
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
            
        with patch('sys.argv', ['script.py', '--release-type', 'release']):
            args = parse_args()
            self.assertEqual(args.release_type, "release")
            
    def test_overwrite_package_version(self):
        # Create a temporary package.json
        package_json = os.path.join(self.temp_dir, 'package.json')
        initial_content = {
            "name": "test-package",
            "version": "1.0.0"
        }
        
        # Write initial content
        with open(package_json, 'w') as f:
            json.dump(initial_content, f, indent='\t')
            f.write('\n')
        
        # Test with v prefix
        overwrite_package_version('v2.0.0', package_json)
        with open(package_json, 'r') as f:
            content = json.load(f)
            self.assertEqual(content['version'], '2.0.0')
        
        # Test without v prefix
        overwrite_package_version('3.0.0', package_json)
        with open(package_json, 'r') as f:
            content = json.load(f)
            self.assertEqual(content['version'], '3.0.0')

    @patch('subprocess.check_output')
    def test_pre_release_to_release_conversion(self, mock_check_output):
        # Mock git tags to show a pre-release
        mock_check_output.return_value = """v1.2.0-pre
v1.1.0""".encode()
        
        # Create a temporary package.json
        package_json = os.path.join(self.temp_dir, 'package.json')
        with open(package_json, 'w') as f:
            json.dump({"version": "1.2.0-pre"}, f)
        
        # Mock no changesets since pre-release
        mock_check_output.side_effect = [
            "v1.2.0-pre\nv1.1.0".encode(),  # for get_last_release_tag
            "".encode()  # for get_changesets_since_tag
        ]
        
        # Test converting pre-release to release
        with patch('sys.argv', ['script.py', '--release-type', 'release', '--package-path', package_json]):
            args = parse_args()
            
            # Get last tag including pre-releases
            tag, is_pre = get_last_release_tag(include_pre=True)
            self.assertEqual(tag, "v1.2.0-pre")
            self.assertTrue(is_pre)
            
            # Get changesets since pre-release
            changesets = get_changesets_since_tag(tag)
            self.assertEqual(len(changesets), 0)
            
            # Version should be converted to release
            new_version = tag.replace("-pre", "")
            self.assertEqual(new_version, "v1.2.0")

if __name__ == '__main__':
    unittest.main()
