from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mcpmint import __main__ as bridge  # noqa: E402


class BridgeTests(unittest.TestCase):
    def test_forwards_to_matching_scoped_npm_package(self) -> None:
        completed = SimpleNamespace(returncode=7)

        with (
            patch.object(bridge, "_find_npx", return_value="/usr/local/bin/npx"),
            patch.object(bridge.sys, "argv", ["mcpmint", "inspect", "api.yaml"]),
            patch.object(bridge.subprocess, "run", return_value=completed) as run,
        ):
            self.assertEqual(bridge.main(), 7)

        run.assert_called_once_with(
            [
                "/usr/local/bin/npx",
                "--yes",
                f"@mcpmint/cli@{bridge.__version__}",
                "inspect",
                "api.yaml",
            ]
        )


if __name__ == "__main__":
    unittest.main()
