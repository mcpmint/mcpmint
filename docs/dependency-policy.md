# Dependency audit policy

CI audits the app, CLI, and actual generated Node archive. New findings fail the audit. Fixes must keep parser behavior, builds, and generated-project checks passing. Weekly Dependabot checks cover app/CLI npm dependencies and GitHub Actions.

On 6 October 2026, app and CLI production dependency audits have zero findings. The generated tsx and TypeScript tools were refreshed as well.

On 7 October, CI reported GHSA-6qxp-vccf-f47h against the generated Node MCP SDK pin. Generated projects now pin SDK 1.32.1, which includes the upstream patch, and generator metadata advances to 2.2.1. Generated dependency audits remain enabled; the SDK advisory is not allowlisted.

The only temporary exception is GHSA-vfj7-8cjw-p6xm in braces <=3.0.3, through the dev-only eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch chain. Registry braces 3.0.3 has no patched release. npm's suggested remediation downgrades Next's ESLint config by two major versions, which is incompatible with this app's Next version.

Exposure: this parser processes repository lint glob patterns, not customer specifications. Keep untrusted inputs out of lint configuration. The app and CLI runtime graphs do not contain this affected chain. The exception is restricted to this advisory, these dev-only package entries, and high severity; new advisory IDs or production exposure fail CI. It expires on 6 November 2026 and must be removed when a compatible upstream fix exists. This is a documented development risk, not a claim of zero findings in all dependencies.
