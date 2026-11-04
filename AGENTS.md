# AI Development Rules

## Keep Store publishing credentials and private records out of GitHub

The user explicitly requires Microsoft Store publishing information that is sensitive to remain local. This applies to commits, pushes, documentation, screenshots, logs, CI artifacts, release uploads, issues and pull request descriptions.

- Never commit Partner Center sign-in credentials, cookies, session URLs, OAuth/client secrets, access/refresh tokens, signing private keys, certificate passwords, private certificates, personal account details, or tax, billing and bank records. Do not print credential values while inspecting or reporting findings.
- Store private publishing files under the ignored `.publishing/`, `.partner-center/` or `.secrets/` directories, or outside the repository. Keep local screenshots, acceptance records and publishing logs in ignored `.cache/` or `release/` directories; review generated material before uploading it anywhere.
- Public Store IDs, package Identity/Publisher/package-family values required for MSIX builds, public company branding, version numbers, checksums and source commit IDs may remain tracked. Do not treat public package identity as an authentication credential. Keep internal submission IDs and account-specific publishing records in local release records rather than public release notes.
- Before every commit, review the staged file list and staged contents for sensitive material; inspect the staged versions, not just the working files. Before every push, review all outgoing commits. Ignore rules do not protect already tracked files or history, and checks must not echo matching secret values.
- If a real credential is found in tracked files or outgoing history, stop the push and report only the file/commit and credential category. Do not silently rewrite shared history or assume deleting the current file revokes an exposed credential; coordinate revocation and history cleanup with the user.

## Prefer existing macOS Keychain credentials for GitHub

For GitHub operations on macOS, prefer the existing credentials supplied by `git credential-osxkeychain` over GitHub CLI OAuth credentials. Check the available credential sources and their actual scopes before requesting browser authorization; a GitHub CLI scope failure does not mean the Keychain credential lacks permission. Never print credential values or store them in repository files. GitHub CLI authentication is separate from Git credential helpers; if CLI operations need the Keychain credential, supply it only to the required process without exposing or persisting it.

## Keep root README files in sync with every version update

Whenever a change bumps, prepares, or publishes a new application version, update the root-level `README.md` and `README.en-US.md` in the same change.

At minimum, review and update all applicable release-facing information in both files:

- current code version and version links;
- latest stable release version, tag link, and release date (only after that version is published);
- version-specific feature highlights, upgrade instructions, and compatibility notes;
- license or conversion-date wording that refers to a specific version;
- stale references that still present an older version as current.

Keep the Chinese and English README content semantically aligned. Before completing a version-related task, search both root README files for the previous version number and confirm that every remaining occurrence is intentional. A version bump or release task is not complete until this README check has been performed.
