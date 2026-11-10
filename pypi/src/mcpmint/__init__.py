"""mcpmint — Python entry point for the mcpmint CLI.

mcpmint's generator is implemented in TypeScript and distributed on npm. This
package is a thin bridge so `pip install mcpmint` gives Python users the same
`mcpmint` command; it runs the `@mcpmint/cli` npm package via `npx` under the
hood. See https://github.com/mcpmint/mcpmint.
"""

__version__ = "0.1.0"
