# mcpmint (Python)

Generate [MCP](https://modelcontextprotocol.io) servers from OpenAPI and Postman specs.

```bash
pip install mcpmint
mcpmint generate ./petstore.json --lang python
```

## Note: this is a bridge to the Node CLI

mcpmint's generator is written in TypeScript and published as `@mcpmint/cli`
on npm. This PyPI package is a thin wrapper so Python users get the same
`mcpmint` command — it runs the npm CLI via `npx` under the hood, pinned to the
matching version.

**It requires [Node.js](https://nodejs.org/) 18.17+** to be installed. If you'd
rather skip the Python layer, install the CLI directly:

```bash
npm install -g @mcpmint/cli
```

Everything else — commands, flags, behavior — is identical to the
[Node CLI](https://github.com/mcpmint/mcpmint/tree/main/cli):

```bash
mcpmint inspect ./petstore.json
mcpmint generate ./api.yaml --lang python --compact --verify full
```

Your spec never leaves your machine.

## License

MIT
