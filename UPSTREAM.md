# Upstream attribution and third-party notices

## cursor-byok

WorkBuddy BYOK began as a derivative of [leookun/cursor-byok](https://github.com/leookun/cursor-byok), licensed under the [MIT License](https://github.com/leookun/cursor-byok/blob/main/LICENSE).

The original desktop application, local gateway foundations, provider adapters, plugin infrastructure, and built-in account plugins informed or supplied portions of this project. We thank **leookun and all upstream contributors**. The original notice **Copyright (c) 2026 leookun** is retained in [LICENSE](LICENSE), together with the permission and warranty terms. WorkBuddy-specific changes are maintained by RyanLi888 and this project's contributors.

This derivative targets WorkBuddy custom models through standard HTTP protocols. Retired Cursor private-protocol modules and development tools are excluded from the current source tree and build. The repository's earlier public commits remain part of its history.

Upstream authors are not responsible for WorkBuddy BYOK changes, releases, or support.

## Dependencies and assets

Rust crates and JavaScript packages retain their own licenses. Exact dependency versions are recorded in `Cargo.lock` and `apps/desktop/package-lock.json`; the project MIT license does not replace dependency licenses.

Third-party product names, logos, and provider icons identify supported integrations. They remain the property of their respective rights holders; this project claims no ownership of those marks or official endorsement.

The locally present `PingFang-Medium.ttf` and `HFKos-R.ttf` files have no accompanying redistribution notices in this checkout. They are excluded from the current published source and builds. The application uses system fonts instead.

The root `LICENSE` and this notice are embedded in the production frontend, including the Windows portable executable, and available through the local application's `/__byok-api__/LICENSE` and `/__byok-api__/UPSTREAM.md` paths.
