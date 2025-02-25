#!/usr/bin/env python3

"""
Integration tests for release notes automation.

Tests the interaction between components and external services.
Makes real API calls to OpenRouter for thorough testing.
"""

import os
import shutil
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from generate_release_notes import generate_release_notes, generate_prompt

import pytest

class TestIntegration:
    @pytest.fixture(autouse=True)
    def setup_teardown(self, request):
        # Setup
        self.test_dir = tempfile.mkdtemp()
        self.original_cwd = os.getcwd()
        os.chdir(self.test_dir)
        
        # Create test changesets directory
        self.changeset_dir = os.path.join(self.test_dir, ".changeset")
        os.makedirs(self.changeset_dir)
        
        # Create test changesets
        self.changesets = [
            {
                "type": "minor",
                "content": "Added new browser automation feature"
            },
            {
                "type": "patch",
                "content": "Fixed issue with file watching"
            }
        ]
        
        # Write test changeset files
        for i, change in enumerate(self.changesets):
            path = os.path.join(self.changeset_dir, f"change-{i}.md")
            with open(path, "w") as f:
                f.write(f"---\n{change['type']}\n{change['content']}")
        
        # Setup test environment
        self.test_version = "v3.3.0"
        self.test_changelog = os.path.join(self.test_dir, "CHANGELOG.md")
        
        # Create initial changelog
        with open(self.test_changelog, "w") as f:
            f.write("# Changelog\n\n## [v3.2.0]\n\nPrevious release notes here.\n")
            
        # Setup common test data
        self.git_info = {
            "commit_log": "test commit",
            "diff_stats": "1 file changed",
            "last_tag": "v3.2.0"
        }

        yield

        # Teardown
        os.chdir(self.original_cwd)
        shutil.rmtree(self.test_dir)
    
    def generate_prompt_for_test(self, git_info=None):
        """Helper method to generate prompt with default or custom git info."""
        return generate_prompt(
            self.changesets,
            git_info or self.git_info,
            self.test_version,
            is_prerelease=False
        )
    
    @patch('subprocess.check_output')
    def test_complete_release_flow(self, mock_git, api_key):
        """Test the complete release flow with live API calls."""
        # Mock git commands
        mock_git.side_effect = [
            "v3.2.0".encode(),  # get_last_release_tag
            "\n".join(os.listdir(self.changeset_dir)).encode()  # get_changesets_since_tag
        ]
            
        # Generate and verify release notes
        prompt = self.generate_prompt_for_test()
        release_notes = generate_release_notes(prompt, api_key=api_key)
        assert release_notes is not None
        assert "browser automation" in release_notes.lower()
        
        # Verify release notes content
        assert "browser automation" in release_notes.lower()
        
    @patch('subprocess.check_output')
    def test_pre_release_flow(self, mock_git, api_key):
        """Test the pre-release flow with live API calls."""
        # Create additional changeset for pre-release
        pre_changeset = {
            "type": "minor",
            "content": "Added experimental feature"
        }
        path = os.path.join(self.changeset_dir, "pre-change.md")
        with open(path, "w") as f:
            f.write(f"---\n{pre_changeset['type']}\n{pre_changeset['content']}")
        
        # Mock git commands for pre-release
        mock_git.side_effect = [
            "v3.2.0".encode(),  # get_last_release_tag
            "\n".join(os.listdir(self.changeset_dir)).encode()  # get_changesets_since_tag
        ]
        
        # Generate pre-release notes
        prompt = generate_prompt(
            self.changesets + [pre_changeset],
            self.git_info,
            f"{self.test_version}-pre",
            is_prerelease=True
        )
        pre_release_notes = generate_release_notes(prompt, api_key=api_key)
        
        # Verify pre-release notes
        assert pre_release_notes is not None
        assert "experimental feature" in pre_release_notes.lower()
        assert "(pre-release)" in pre_release_notes.lower()
        
    @patch('subprocess.check_output')
    def test_pre_release_to_release_flow(self, mock_git, api_key):
        """Test converting a pre-release to a full release."""
        # First create a pre-release
        pre_version = f"{self.test_version}-pre"
        pre_prompt = generate_prompt(
            self.changesets,
            self.git_info,
            pre_version,
            is_prerelease=True
        )
        pre_release_notes = generate_release_notes(pre_prompt, api_key=api_key)
        assert "(pre-release)" in pre_release_notes.lower()
        
        # Mock git commands showing no changes since pre-release
        mock_git.side_effect = [
            f"{pre_version}\nv3.2.0".encode(),  # get_last_release_tag with pre
            "".encode(),  # no changesets since pre-release
            "v3.2.0".encode(),  # get_last_release_tag without pre
            "\n".join(os.listdir(self.changeset_dir)).encode()  # all changesets since last regular release
        ]
        
        # Generate full release notes
        release_prompt = generate_prompt(
            self.changesets,
            self.git_info,
            self.test_version,
            is_prerelease=False
        )
        release_notes = generate_release_notes(release_prompt, api_key=api_key)
        
        # Verify full release notes include all changes
        assert release_notes is not None
        assert "browser automation" in release_notes.lower()
        assert "(pre-release)" not in release_notes.lower()
    
    def test_error_handling(self, api_key):
        """Test error handling in the release flow."""
        empty_git_info = {
            "commit_log": "",
            "diff_stats": "",
            "last_tag": "v3.2.0"
        }
        
        # Test API errors
        with patch('requests.post') as mock_post:
            mock_post.side_effect = Exception("API Error")
            with pytest.raises(Exception, match="API Error"):
                prompt = self.generate_prompt_for_test(empty_git_info)
                generate_release_notes(prompt, api_key=api_key)
        
        # Test rate limiting
        with patch('requests.post') as mock_post:
            mock_post.return_value.status_code = 429
            with pytest.raises(Exception, match="Rate limit exceeded"):
                prompt = self.generate_prompt_for_test(empty_git_info)
                generate_release_notes(prompt, api_key=api_key)
        
        # Test invalid API key
        with patch('requests.post') as mock_post:
            mock_post.return_value.status_code = 401
            with pytest.raises(Exception, match="Invalid API key"):
                prompt = self.generate_prompt_for_test(empty_git_info)
                generate_release_notes(prompt, api_key=api_key)

if __name__ == '__main__':
    unittest.main()
