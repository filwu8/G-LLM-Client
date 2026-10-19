# Microsoft Store MSIX

## Product identity

- Account: filwu@outlook.com, company publisher GPROPHET LIMITED.
- Store ID: `9MVD547V4ZN9`.
- Identity: `GPROPHETLIMITED.G-LLMClient`.
- Publisher: `CN=47A4A51B-7614-4112-BA6F-13F6A84141F9`.
- Package family: `GPROPHETLIMITED.G-LLMClient_e9rwfmt1kwxfa`.
- Application ID: `GLLMClient`.

Identity values come from Partner Center and are stored in `build/msix-identity.json`. Store packages use the app version with a fourth zero component, for example `2.0.24.0`.

## Build

On Windows, install locked dependencies and set `MSIX_SDK_BIN` to the x64 binary directory of the official Windows SDK (containing `makeappx.exe`). Then run `pnpm package:msix`.

To reuse an already packaged Windows directory:

```powershell
node scripts/package-msix.mjs --app-dir dist/win-unpacked --sdk-bin "C:\path\to\Windows SDK\x64" --output-dir dist/msix
```

The packager creates required logo sizes from the existing app icon and validates the package with MakeAppx. The Store package is intentionally unsigned: Microsoft signs it during Store distribution. Do not use a development certificate to sign the Store upload.

## Store behavior

- Microsoft Store editions do not check GitHub releases, download EXE updates, or execute the NSIS updater. The update action opens this product's Store page.
- Protocol registration is declared in the package manifest instead of being written by the application.
- Windows manages the package application identity. The NSIS app user model ID is not assigned to Store processes.
- Required capabilities: `internetClient` and `runFullTrust`. Full trust is needed for Electron desktop windows and user-authorized local file and tool workflows. The package does not install drivers or services.
- Desktop x64, Windows 10 build 19041 or newer. Other architectures and device families have not been accepted.

## Acceptance

`--acceptance` creates a separate package identity and display name, and a separate `gllm-acceptance` protocol to avoid taking over the installed app's protocol. It is never uploaded to the Store. Signing and temporary certificate trust, if authorized, are local acceptance steps only. Remove the acceptance package and temporary trust after testing; retain user data from existing installations.

Check installation, launch, data persistence across relaunch, single-instance behavior, tray and main-window activation, Store-managed update behavior, native modules, and uninstall. Test the production `gllm` protocol separately once an actual Store-signed package is available; the acceptance package intentionally does not claim it.

Do not mark installation acceptance complete based on MakeAppx success alone. Store submission also requires complete listing text/screenshots, pricing, age ratings, capability declarations, and privacy details.
