"""Bridge the `mcpmint` command to the npm-published CLI via npx.

The generator lives in the `@mcpmint/cli` npm package (TypeScript). This wrapper
locates Node's `npx` and forwards all arguments to `npx @mcpmint/cli@<version>`,
pinned to this package's version so the two stay in lockstep. It deliberately
invokes `npx @mcpmint/cli` (never a bare `mcpmint`, which on PATH could be THIS
script and would recurse).
"""

from __future__ import annotations

import shutil
import subprocess
import sys

from . import __version__

NODE_INSTALL_HINT = (
    "mcpmint needs Node.js (18.17+) to run.\n"
    "The generator is a Node package; this Python entry point runs it via npx.\n"
    "Install Node from https://nodejs.org/ (or your package manager), then re-run.\n"
    "Alternatively, install the CLI directly with npm:  npm install -g @mcpmint/cli"
)


def _find_npx() -> str | None:
    # npx ships with Node/npm. On Windows it is npx.cmd, which shutil.which finds
    # via PATHEXT.
    return shutil.which("npx")


def main() -> int:
    npx = _find_npx()
    if npx is None:
        print(NODE_INSTALL_HINT, file=sys.stderr)
        return 1

    # `--yes` so npx fetches the package non-interactively if it isn't cached.
    # Pin to this wrapper's version so `pip install mcpmint==X` runs npm X.
    command = [npx, "--yes", f"@mcpmint/cli@{__version__}", *sys.argv[1:]]

    try:
        completed = subprocess.run(command)  # noqa: S603 - args are fixed + user CLI flags
    except KeyboardInterrupt:
        return 130
    except OSError as error:
        print(f"mcpmint: failed to run npx: {error}", file=sys.stderr)
        print(NODE_INSTALL_HINT, file=sys.stderr)
        return 1

    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
