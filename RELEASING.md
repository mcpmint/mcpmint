# Releasing mcpmint

The web app deploys continuously — every merge to `main` ships via Vercel.
The **packages** (npm `@mcpmint/cli`, PyPI `mcpmint`) release only when a version
tag is pushed. CI does the publishing; no tokens live on any machine.

## Cutting a release

```bash
# 1. Bump every version site in lockstep (cli/package.json, cli/package-lock.json,
#    pypi/pyproject.toml, pypi/src/mcpmint/__init__.py):
node scripts/release-version.mjs --set 0.2.0

# 2. Land it on main (commit directly or via PR, per your flow):
git commit -am "release: 0.2.0" && git push

# 3. Tag — this is the trigger:
git tag v0.2.0 && git push --tags
```

The `Release` workflow then runs, in order:

1. **Quality gate** — lint, typecheck, full test suite, CLI build. A red suite
   blocks the release.
2. **Version lockstep check** — the tag must equal the version in all four
   sites. This matters more here than in most repos: the PyPI wrapper executes
   `npx @mcpmint/cli@<its own version>`, so a drifted wrapper would silently run a
   different generator than it claims.
3. **Publish npm + PyPI** (parallel) via OIDC Trusted Publishing.
4. **GitHub release** with generated notes.

## One-time registry setup

- **PyPI**: pypi.org → your account → Publishing → *add a pending publisher*
  for project `mcpmint`: owner `mcpmint`, repo `mcpmint`, workflow
  `release.yml`, environment `pypi`. Works before the first upload — even the
  first PyPI release can go through CI.
- **npm**: trusted publishing can only be configured on an existing package,
  so the **first** npm publish is manual (`npm login`, then `npm publish` from
  `cli/`). Immediately after, on npmjs.com → package `@mcpmint/cli` → Settings →
  configure the Trusted Publisher (repo `mcpmint/mcpmint`, workflow
  `release.yml`) — after that, no npm token exists anywhere. The workflow
  treats an already-published npm version as a successful no-op so the manual
  bootstrap version can still share its tag with the first PyPI release.

## Rules of thumb

- Registries are immutable: a published version can never be reused. If a
  release is bad, ship a fixed `x.y.z+1` — don't try to unpublish.
- Bump the version in the same PR as the change when practical, so the tag
  can point at a main commit that already carries the right version.
