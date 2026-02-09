"""Pytest configuration and fixtures."""

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest


@pytest.fixture
def temp_project():
    """Create a temporary project directory."""
    with TemporaryDirectory() as tmpdir:
        project = Path(tmpdir)
        yield project


@pytest.fixture
def sample_python_file(temp_project: Path) -> Path:
    """Create a sample Python file for testing."""
    file_path = temp_project / "sample.py"
    file_path.write_text('''"""Sample module for testing."""

from typing import Optional

class User:
    """A user class."""

    def __init__(self, name: str) -> None:
        self.name = name

    def greet(self) -> str:
        """Return a greeting."""
        return f"Hello, {self.name}!"

def process_user(user: User) -> str:
    """Process a user and return greeting."""
    return user.greet()

def main() -> None:
    """Main entry point."""
    user = User("World")
    print(process_user(user))
''')
    return file_path


@pytest.fixture
def multi_file_project(temp_project: Path) -> Path:
    """Create a project with multiple files for testing."""
    # models.py
    models = temp_project / "models.py"
    models.write_text('''"""Data models."""

class User:
    """A user model."""

    def __init__(self, name: str, email: str) -> None:
        self.name = name
        self.email = email

    def display_name(self) -> str:
        """Get display name."""
        return self.name

class Admin(User):
    """Admin user with extra privileges."""

    def __init__(self, name: str, email: str, role: str) -> None:
        super().__init__(name, email)
        self.role = role
''')

    # services.py
    services = temp_project / "services.py"
    services.write_text('''"""Business services."""

from models import User, Admin

def create_user(name: str, email: str) -> User:
    """Create a new user."""
    return User(name, email)

def create_admin(name: str, email: str, role: str) -> Admin:
    """Create a new admin."""
    return Admin(name, email, role)

def get_user_display(user: User) -> str:
    """Get user display string."""
    return user.display_name()
''')

    # test_services.py
    tests = temp_project / "test_services.py"
    tests.write_text('''"""Tests for services."""

from services import create_user, get_user_display

def test_create_user():
    """Test user creation."""
    user = create_user("Test", "test@example.com")
    assert user.name == "Test"

def test_display():
    """Test display name."""
    user = create_user("Test", "test@example.com")
    assert get_user_display(user) == "Test"
''')

    return temp_project
