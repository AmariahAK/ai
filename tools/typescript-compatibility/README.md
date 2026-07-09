# TypeScript compatibility harness

This workspace verifies that compiler upgrades do not change the published AI
SDK surface. It always tests packed packages rather than workspace source
files, so it exercises the same `package.json` exports and declaration files
that consumers receive.

Run the harness from the workspace root:

```bash
pnpm --filter typescript-compatibility check
```

`check` discovers every non-private package under `packages/`, packs each one,
and installs all tarballs into an isolated temporary consumer. Before the
default package build, it removes every discovered package's top-level `dist`
directory and forces the build so stale compiler output or a Turbo cache entry
cannot enter a tarball. Each compiler and
module-resolution mode runs two gates:

1. `all-exports` resolves every explicit package export with
   `skipLibCheck: true`. This exhaustive tier catches package/export-map and
   declaration-syntax incompatibilities without making unrelated transitive
   dependency declarations part of the AI SDK compiler migration.
2. `representative` uses `skipLibCheck: false` for representative core,
   provider, schema, UI, embedding, and image APIs. Its fixture installs the
   consumer-owned React and JSON Schema types required by those public APIs.

Both gates run with Bundler and NodeNext module resolution. There are no broad
diagnostic ignores or expected-error allowlists.

By default the fixture installs and runs these compiler aliases:

| Label | Fixture dependency                               |
| ----- | ------------------------------------------------ |
| 5.8.3 | `typescript-5@npm:typescript@5.8.3`              |
| 6.0.2 | `typescript-6@npm:@typescript/typescript6@6.0.2` |
| 7.0.2 | `typescript-7@npm:typescript@7.0.2`              |

The isolated consumer pins the compatibility package's `typescript@^6`
dependency to 6.0.2, so a newer TS6 patch cannot silently change the matrix.
It also carries exact release-age exceptions for these compiler packages and
TS7's platform binaries while the repository evaluates the fresh release.

An exact compiler executable can replace the default matrix. This is useful
while developing a compiler branch or before an alias is present in the
workspace:

```bash
pnpm --filter typescript-compatibility check -- \
  --compiler 5.8.3=/absolute/path/to/tsc
```

The harness uses `corepack pnpm` so packing follows the repository's pinned
pnpm version. Use `PNPM_EXECUTABLE` to select a different executable. Pass
`--keep` to retain the temporary directory printed by the command for
debugging. `--skip-build` is available only when the caller has just completed
a clean `pnpm build:packages`; it skips both the cleanup and build. CI and
baseline comparisons should use the default rebuild.

## Artifact snapshots

Store baselines outside the repository. A snapshot records each packed
package's public metadata, tarball file list, and hashes for JavaScript,
declaration, and sourcemap artifacts.

```bash
pnpm --filter typescript-compatibility snapshot -- \
  --output /tmp/ai-sdk-typescript-5.8-artifacts.json

pnpm --filter typescript-compatibility compare -- \
  --baseline /tmp/ai-sdk-typescript-5.8-artifacts.json
```

Any metadata, file-list, or artifact-content difference makes `compare` fail
and prints the exact paths that require review.
