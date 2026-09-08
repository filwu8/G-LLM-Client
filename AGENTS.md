# AI Development Rules

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
