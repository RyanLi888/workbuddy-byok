import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "@tauri-apps/cli";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const source = join(desktop, "src/shared/assets/icons/workbuddy.png");
const output = join(desktop, "src-tauri/icons");
const generated = await mkdtemp(join(tmpdir(), "workbuddy-icons-"));
try {
  await run(["icon", source, "--output", generated]);
  for (const name of ["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.icns"]) {
    await copyFile(join(generated, name), join(output, name));
  }
  await copyFile(source, join(output, "icon.png"));
} finally {
  if (dirname(resolve(generated)) !== resolve(tmpdir())) throw new Error("Icon temporary directory is outside the system temporary directory");
  await rm(generated, { recursive: true, force: true });
}
