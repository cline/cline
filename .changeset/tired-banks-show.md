---
"claude-dev": minor
---

This PR introduces a Python gRPC codegen flow analogous to the existing Go flow. A Node script (scripts/build-python-proto.mjs) generates Python protobuf and gRPC stubs, plus a Go-like client under src/generated/grpc-python/client. The script also writes a minimal pyproject.toml in the generated directory to enable pip install -e src/generated/grpc-python. Documentation was added to explain setup and usage, and a GitHub Actions workflow was added to publish the generated package to PyPI using a single repo secret (PYPI_API_TOKEN).
