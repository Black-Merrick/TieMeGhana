"""
Shared pytest fixtures.

Anything more than one app's tests need lives here, so fixtures are defined
once rather than copied between test modules as the feature apps grow.
"""

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client() -> APIClient:
    """A DRF test client for exercising API contracts the frontend depends on."""
    return APIClient()
