import { createHash } from "node:crypto";
import { open, readdir, readFile } from "node:fs/promises";
import { release } from "node:os";
import { basename } from "node:path";
import { Effect } from "effect";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";

interface TestedNativeConfiguration {
  platform: "linux";
  architecture: string;
  osMajor: string;
  kernelRelease: string;
  displayBackend: "x11-xvfb";
  driverDigest: string;
  remoteDigests: { sunshine: string; moonlightWebServer: string; moonlightStreamer: string };
}
// Entries require reviewed native and Electron evidence for this exact configuration. Reports are never loaded here.
const TESTED_NATIVE_CONFIGURATIONS: readonly TestedNativeConfiguration[] = [];

/** Main-only platform gate. An environment flag, report path or renderer capability cannot enable it. */
export const privatePlanningSupported = Effect.fn("PrivatePlanningSupport.available")(function* (
  driver: string | null,
  remote: RemoteDesktopRuntimePaths | null,
) {
  const candidates = TESTED_NATIVE_CONFIGURATIONS.filter(
    (target) =>
      target.platform === process.platform &&
      target.architecture === process.arch &&
      target.kernelRelease === release(),
  );
  if (candidates.length === 0 || !driver || !remote) return false;
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const os = await readFile("/etc/os-release", "utf8");
      const osMajor = /^VERSION_ID="(\d+)/mu.exec(os)?.[1];
      const display = process.env.DISPLAY;
      if (
        !display ||
        !/^:\d+$/u.test(display) ||
        (process.env.OPENBOT_AGENT_DISPLAY && process.env.OPENBOT_AGENT_DISPLAY !== display)
      )
        return false;
      let xvfb = false;
      for (const pid of (await readdir("/proc")).filter((value) => /^\d+$/u.test(value))) {
        let args: string[];
        try {
          args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
        } catch (cause) {
          if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") continue;
          throw cause;
        }
        if (basename(args[0] ?? "") === "Xvfb" && args.includes(display)) xvfb = true;
      }
      if (!xvfb) return false;
      const driverDigest = await binaryDigest(driver, signal);
      const sunshine = await binaryDigest(remote.sunshine, signal);
      const moonlightWebServer = await binaryDigest(remote.moonlightWebServer, signal);
      const moonlightStreamer = await binaryDigest(remote.moonlightStreamer, signal);
      return candidates.some(
        (target) =>
          target.osMajor === osMajor &&
          target.driverDigest === driverDigest &&
          target.remoteDigests.sunshine === sunshine &&
          target.remoteDigests.moonlightWebServer === moonlightWebServer &&
          target.remoteDigests.moonlightStreamer === moonlightStreamer,
      );
    },
    catch: () => false,
  }).pipe(Effect.catch(() => Effect.succeed(false)));
});
async function binaryDigest(path: string, signal: AbortSignal): Promise<string> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error("Unsupported native executable.");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ signal })) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}
