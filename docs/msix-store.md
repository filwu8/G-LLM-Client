# Microsoft Store MSIX

## Product identity

- Company publisher: GPROPHET LIMITED.
- Store ID: `9MVD547V4ZN9`.
- Identity: `GPROPHETLIMITED.G-LLMClient`.
- Publisher: `CN=47A4A51B-7614-4112-BA6F-13F6A84141F9`.
- Package family: `GPROPHETLIMITED.G-LLMClient_e9rwfmt1kwxfa`.
- Application ID: `GLLMClient`.

Identity values come from Partner Center and are stored in `build/msix-identity.json`. Store packages use the app version with a fourth zero component, for example `2.0.24.0`.

These package identity values are public metadata, not credentials. Keep Partner Center passwords, client secrets, access/refresh tokens, signing private keys, certificate passwords, and local acceptance certificates outside the repository. Store packages are signed by Microsoft; no signing private key belongs in this project. `.gitignore` excludes common local signing files and packaged uploads, but review the staged diff before every release commit: ignore rules do not protect secrets already tracked by Git.

## Build

On Windows, install locked dependencies and set `MSIX_SDK_BIN` to the x64 binary directory of the official Windows SDK (containing `makeappx.exe`). Then run `pnpm package:msix`.

To reuse an already packaged Windows directory:

```powershell
node scripts/package-msix.mjs --app-dir dist/win-unpacked --sdk-bin "C:\path\to\Windows SDK\x64" --output-dir dist/msix
```

The packager creates required logo sizes from the existing app icon and validates the package with MakeAppx. The Store package is intentionally unsigned: Microsoft signs it during Store distribution. Do not use a development certificate to sign the Store upload.

## Store behavior

Version 2.0.25 changes the display name to `知言 · G-LLM Client`. The MSIX display name is read from `build.productName` in package.json. Keep the existing identity, publisher, application ID, Store ID, executable filename, protocol and storage paths when renaming. Reserve the new product name in Partner Center and select it for every Store listing language before submitting the renamed package. A dashboard alias alone does not rename the live Store listing.

- Microsoft Store editions do not check GitHub releases, download EXE updates, or execute the NSIS updater. The update action opens this product's Store page.
- Protocol registration is declared in the package manifest instead of being written by the application.
- Windows manages the package application identity. The NSIS app user model ID is not assigned to Store processes.
- Required capabilities: `internetClient` and `runFullTrust`. Full trust is needed for Electron desktop windows and user-authorized local file and tool workflows. The package does not install drivers or services.
- Desktop x64, Windows 10 build 19041 or newer. Other architectures and device families have not been accepted.

## Acceptance

The selected release route is a private Microsoft Store audience followed by installation acceptance of the Microsoft-signed package. Keep automatic public availability disabled. The initial tester group contains only the authorized publisher account. Complete private certification and install from that account before considering public availability; private submission itself does not prove installation acceptance.

The local acceptance package could not be installed because its self-signed certificate was untrusted (0x800B0109). The generated certificate and private key were removed, and no TrustedPeople or root trust was added. Do not treat this failed attempt as a successful installation test.

`--acceptance` creates a separate package identity and display name, and a separate `gllm-acceptance` protocol to avoid taking over the installed app's protocol. It is never uploaded to the Store. Signing and temporary certificate trust, if authorized, are local acceptance steps only. Remove the acceptance package and temporary trust after testing; retain user data from existing installations.

Check installation, launch, data persistence across relaunch, single-instance behavior, tray and main-window activation, Store-managed update behavior, native modules, and uninstall. Test the production `gllm` protocol separately once an actual Store-signed package is available; the acceptance package intentionally does not claim it.

Do not mark installation acceptance complete based on MakeAppx success alone. Store submission also requires complete listing text/screenshots, pricing, age ratings, capability declarations, and privacy details.
