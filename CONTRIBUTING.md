# Contributing to G-LLM Desktop Client

Thank you for considering a contribution to G-LLM Desktop Client.

## Before You Contribute

G-LLM Desktop Client V1.1.0 and later source releases are licensed under the
Business Source License 1.1 (`BUSL-1.1`) with the parameters stated in
[LICENSE](./LICENSE). V1.0.10 and earlier remain under the license included in
their corresponding release tags.

By submitting a contribution, you confirm that:

1. you created the contribution or otherwise have the right to submit it;
2. the contribution does not knowingly include confidential information,
   trade secrets, or code that you are not authorized to provide;
3. third-party code and assets are identified with their source and license;
4. you grant GPROPHET LIMITED a perpetual, worldwide, irrevocable,
   non-exclusive, royalty-free copyright license to use, reproduce, modify,
   distribute, sublicense, relicense, and commercially license the
   contribution as part of G-LLM Desktop Client; and
5. your contribution may be released under the current source license, a
   future version of that license, the stated Change License, or a separate
   commercial license.

This contribution grant does not transfer ownership of your copyright. For a
material contribution, GPROPHET LIMITED may require a separately signed
Contributor License Agreement before accepting it.

Do not submit a contribution if you cannot make these confirmations.

## Development Workflow

- Open an issue or discussion before substantial architectural work.
- Keep changes focused and include tests appropriate to the affected behavior.
- Run `pnpm build` before submitting a change.
- Preserve copyright, SPDX, license, attribution, and trademark notices.
- Do not commit credentials, customer data, private prompts, or licensed assets
  that are not intended for source distribution.

### Local checks

Node 22.12 or newer and pnpm 10.29.1 (see `packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm test                    # the main suite
pnpm test:workspace-experience   # workspace agent integration fixture
pnpm build                   # i18n:check, tsc, renderer/main bundles, bundle verification
```

CI runs more than `pnpm build`, and two of its checks surprise people:

- `pnpm audit --audit-level low` fails the build on any reported vulnerability.
- After `pnpm build`, CI asserts `THIRD_PARTY_NOTICES.md` is unchanged. If you
  touched a dependency, run `pnpm licenses:generate` and commit the result.

### Test files must be registered

Test discovery is an explicit list in the `test` script of `package.json`, not a
glob. A new `*.test.ts` file that is not added there will never run in CI, and
nothing will tell you. `src/main/testSuiteIntegrity.test.ts` fails the build when
a test file is unregistered, so add the path in the same commit as the test.

### Keep a pull request small

One pull request, one concern. A reviewer cannot properly assess a change that
rewrites unrelated files, and a large diff hides accidental deletions. If a
feature needs more than roughly ten files, split it into sequential pull
requests that each leave the build green.

## AI-assisted contributions

AI assistance is welcome. These rules exist because the failure modes are
specific and repeat silently:

- **Verify before you claim.** Do not write "tested" or "works" in a commit
  message or pull request unless you ran the command and read the output. Paste
  the command and its output instead of describing it.
- **Prove a new test can fail.** Break the implementation on purpose, watch the
  test go red, restore it, watch it go green. A test that has never failed
  proves nothing about the code it claims to protect.
- **Do not let a tool decide scope.** Review the full file list before committing
  and revert churn that is not part of the task: reordered imports, reformatted
  untouched functions, renamed locals.
- **Treat isolation and permission changes as high risk.** Executing
  model-written code requires a separate process with the `--permission` flag and
  a filesystem allowlist, as `run_javascript` does. `node:vm` is not a security
  boundary: it isolates globals, not realms, so any host function inside the
  context exposes the host `Function` constructor and with it the real process.
  Do not add an in-process evaluator, and do not remove an execution tool from
  the approval set.
- **Say what you did not verify.** An honest gap is easy to review; an unverified
  claim that looks verified is not.

## Third-Party Dependencies

New dependencies must have a documented license compatible with this project.
When dependencies change, run `pnpm licenses:generate` and include the updated
`THIRD_PARTY_NOTICES.md` in the contribution.

## Security Reports

Do not disclose a suspected vulnerability in a public issue. Contact
`security@gprophet.com` with enough detail to reproduce and assess the issue.

## Commercial and Brand Questions

For commercial licensing or trademark authorization, contact
`licensing@gprophet.com`. See [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md)
and [TRADEMARKS.md](./TRADEMARKS.md).
