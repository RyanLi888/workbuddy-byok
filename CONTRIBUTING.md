# Contributing

Issues and pull requests are welcome. For a bug, include your application version, operating system, reproduction steps, and expected and actual behavior. Redact keys, account identifiers, prompts, and request logs. Report security problems privately as described in [SECURITY.md](SECURITY.md).

Use the issue forms for bug reports and feature requests, and [Discussions](https://github.com/RyanLi888/workbuddy-byok/discussions) for usage questions and community conversations. All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

Install Rust stable, Node.js 22 or newer, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Linux builds need WebKitGTK 4.1, Ayatana AppIndicator, librsvg, and patchelf. Windows builds need the Microsoft C++ build tools and WebView2.

```sh
npm ci --prefix apps/desktop
npm run tauri:dev --prefix apps/desktop
```

The desktop embeds the Rust server. For browser development, use `npm run dev:web --prefix apps/desktop`. For account plugin tests, use the pinned Deno runtime configured in `server/src/plugin/runtime.rs` (the app installs it through Plugins).

## Checks

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
npm run check --prefix apps/desktop
npm --prefix apps/desktop run tauri:build -- --debug --no-bundle
node --test .github/scripts/*.test.mjs
```

In each directory under `server/plugins/build-in/`, run `deno test --config deno.json` for offline plugin checks. Tests use mock credentials; real account access still needs a user-authorized login and connectivity test.

## Packaging

```sh
npm --prefix apps/desktop run tauri:build -- --no-bundle
npm --prefix apps/desktop run tauri -- bundle --bundles nsis
```

The second command is the Windows example; use `app,dmg` on macOS or `deb,appimage` on Linux. To generate signed updater artifacts, set `TAURI_SIGNING_PRIVATE_KEY` to the contents of your own signing key and configure its password as needed. Local packages signed with a different key cannot replace the official updater key. Never commit private keys.

Platform installer output is under `target/release/bundle/`; cross-target macOS builds use `target/<target>/release/bundle/`. Official releases are built by `.github/workflows/release.yml` from an owner-pushed `v<version>` tag already contained in `main`. Ordinary pushes run CI only. Desktop versions must agree in package manifests, package locks, and Tauri configuration. All platform builds must finish before a release is published.

## Standalone server and Docker

```sh
npm run build --prefix apps/desktop
cargo build --release --locked --package workbuddy-server --bin workbuddy-server
docker build --tag workbuddy-byok:local .
```

Set `WORKBUDDY_CONSOLE_DIR=apps/desktop/dist` when running the standalone server from the repository root. Docker stores data in `/data`; mount a writable host directory for persistence, and mount the host WorkBuddy model directory at `/data/workbuddy` when synchronization is needed. The container runs as UID 10001, which needs write access to those mounts.

## Scope and review

Keep frontend features under `apps/desktop/`, gateway behavior under `server/`, and build automation under `.github/`. Include focused validation for behavior changes and explain the user-visible effect in the pull request. Keep secrets, runtime data, generated bundles, local AI instructions, and retired modules out of commits. Contributions are distributed under the [MIT License](LICENSE); retain upstream notices when adapting code.
