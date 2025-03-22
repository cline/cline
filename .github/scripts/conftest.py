import pytest

def pytest_addoption(parser):
    parser.addoption(
        "--api-key",
        action="store",
        help="API key for integration tests"
    )

@pytest.fixture
def api_key(request):
    """Fixture to provide API key to tests."""
    api_key = request.config.getoption("--api-key")
    if not api_key:
        pytest.skip("API key is required for integration tests")
    return api_key
