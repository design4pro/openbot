import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result } from "effect";
import { z } from "zod";
import { CUA_DRIVER_VENDOR_CALLS_OFF } from "../../src/main/cua-driver-artifact";
import { CuaDriverDaemonClient } from "../../src/main/cua-driver-daemon-client";
import { CuaDriverRuntime } from "../../src/main/cua-driver-runtime";
import { PrivatePlanningError } from "../../src/main/private-planning-admission";
import { resolveRemoteDesktopRuntime } from "../../src/main/remote-desktop-runtime-artifact";
import { RemoteScreenGateway } from "../../src/main/remote-screen-gateway";
import { loadCuaDriverLock } from "../cua-driver-lock";
import { verifyRuntimeTree } from "../install-remote-desktop-runtime";
import { loadNativeRuntimeLock } from "../native-runtime-lock";
import { nativePlanningFixture } from "./native-fixture";

const logger = createOpenBotLogger("planning-native");

/** Real native processes on an explicitly selected synthetic Linux display. Never runs on macOS. */
export async function nativeCases(
  root: string,
  display: string,
  onCase: (id: string) => void = () => {},
): Promise<{
  cases: string[];
  nativeRuntime: {
    driverDigest: string;
    driverVersion: string;
    displayBackend: "x11";
    osMajor: string;
    kernelRelease: string;
    executionEnvironment: string;
    remoteDigests: { sunshine: string; moonlightWebServer: string; moonlightStreamer: string };
  };
}> {
  assert.equal(process.platform, "linux", "Native proof requires an isolated Linux display.");
  assert.match(display, /^:\d+$/u);
  assert.equal(display, process.env.DISPLAY);
  assert.equal(process.env.OPENBOT_PLANNING_ISOLATED, "xvfb");
  // The proof runs only where an actual Xvfb process owns the selected display.
  const { readdir } = await import("node:fs/promises");
  const processes = await readdir("/proc");
  let xvfb = false;
  for (const pid of processes.filter((value) => /^\d+$/u.test(value))) {
    const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    const args = command.split("\0");
    if (basename(args[0] ?? "") === "Xvfb" && args.includes(display)) xvfb = true;
  }
  assert.ok(xvfb, "No Xvfb owns the selected display.");
  logger.info("Native preflight passed.", { stage: "xvfb" });
  const executable = resolve(
    process.env.OPENBOT_PLANNING_DRIVER ?? join("build", "cua-driver", "linux", process.arch, "cua-driver"),
  );
  const lock = await loadCuaDriverLock();
  const digest = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  assert.equal(digest, lock.artifacts[process.arch === "arm64" ? "linux-arm64" : "linux-x64"].files["cua-driver"]);
  const os = await readFile("/etc/os-release", "utf8");
  const osMajor = /^VERSION_ID="(\d+)/mu.exec(os)?.[1];
  assert.ok(osMajor);
  const { admission, native } = nativePlanningFixture(join(root, "native-state"), () => [
    join(directory, "driver.sock"),
  ]);
  const directory = join("/tmp", `p-${root.split("/").at(-3)?.slice(0, 8) ?? process.pid}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const runtime = new CuaDriverRuntime({
    privatePlanningNative: native,
    executable,
    endpoint: { kind: "unix-socket", directory },
    supported: true,
    hostBundleId: "openbot.planning.native-proof",
    platform: "linux",
  });
  const cases: string[] = [];
  const record = (id: string) => {
    cases.push(id);
    onCase(id);
    logger.info("Native case passed.", { caseId: id });
  };
  const announcements = { count: 0 };
  runtime.onMcpServerChanged(() => {
    announcements.count++;
  });
  let direct: Socket | null = null;
  let client: Client | null = null;
  try {
    await Effect.runPromise(runtime.warmUp());
    assert.equal(runtime.lastState.status, "ready");
    assert.equal(runtime.running(), true);
    logger.info("Real native daemon started.");
    direct = connect(runtime.socketPath());
    const directClosed = once(direct, "close", { signal: AbortSignal.timeout(120000) });
    await new Promise<void>((resolve, reject) => {
      direct?.once("connect", resolve);
      direct?.once("error", reject);
    });
    client = new Client({ name: "planning-native-proof", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: executable,
        args: ["mcp", "--socket", runtime.tapAddress()],
        env: { ...getDefaultEnvironment(), ...CUA_DRIVER_VENDOR_CALLS_OFF, DISPLAY: display, CUA_DRIVER_EMBEDDED: "1" },
      }),
    );
    const tools = await client.listTools();
    await writeFile(
      join(dirname(root), "native-input-tools.json"),
      JSON.stringify(
        tools.tools.filter((tool) => /key|type|hold|wait/u.test(tool.name)),
        null,
        2,
      ),
      { mode: 0o600 },
    );
    assert.ok(
      tools.tools.some((tool) => tool.name === "list_windows"),
      "The pinned driver has no window read tool.",
    );
    const read = await client.callTool({ name: "list_windows", arguments: { on_screen_only: true } });
    assert.notEqual(read.isError, true);
    await Effect.runPromise(runtime.stop());
    await directClosed;
    assert.equal(direct.destroyed, true);
    const stale = await client
      .callTool({ name: "list_windows", arguments: { on_screen_only: true } })
      .catch(() => null);
    assert.ok(stale === null || stale.isError === true, "A stale proxy can still read native windows.");
    record("stale-native-client");
    await Effect.runPromise(runtime.warmUp());
    // An existing public daemon must prevent private admission, even with no reported agent session.
    const entered = await Effect.runPromise(Effect.result(admission.enterPrivate()));
    assert.ok(Result.isFailure(entered), "A live native daemon did not block private entry.");
    assert.equal(entered.failure.code, "privacy_busy");
    record("native-public-lifetime");
    const blocker = native.blockers().find((item) => item.kind === "cua_runtime");
    assert.ok(blocker);
    await Effect.runPromise(native.stopOwnedActivity(blocker.id));
    await Effect.runPromise(admission.enterPrivate());
    const refused = await Effect.runPromise(Effect.result(runtime.start()));
    assert.ok(Result.isFailure(refused));
    assert.equal(runtime.running(), false);
    assert.equal((await Effect.runPromise(runtime.state())).status, "error");
    await Effect.runPromise(runtime.warmUp());
    assert.equal(runtime.running(), false);
    for (const address of [join(directory, "tap.sock"), runtime.socketPath()]) {
      const freshProxy = new Client({ name: "planning-cached-config-proof", version: "1" });
      const freshTransport = new StdioClientTransport({
        command: executable,
        args: ["mcp", "--socket", address],
        env: { ...getDefaultEnvironment(), ...CUA_DRIVER_VENDOR_CALLS_OFF, DISPLAY: display, CUA_DRIVER_EMBEDDED: "1" },
      });
      let nativeRead = false;
      try {
        await freshProxy.connect(freshTransport, { timeout: 15000 });
        const answer = await freshProxy.callTool(
          { name: "list_windows", arguments: { on_screen_only: true } },
          undefined,
          { timeout: 15000 },
        );
        nativeRead = answer.isError !== true;
      } catch {
        /* Transport refusal also prevents native access. */
      } finally {
        await freshProxy.close();
        await freshTransport.close();
      }
      assert.equal(nativeRead, false, "A cached proxy configuration restarted native access during private planning.");
    }
    record("native-private-restart");
    await Effect.runPromise(admission.finishPrivateExit());
    await Effect.runPromise(runtime.start());
    assert.equal(runtime.running(), true);
    assert.equal((await Effect.runPromise(runtime.state())).status, "ready");
    assert.equal(announcements.count, 0, "An intentional private pause must preserve the provider tool identity.");
    record("native-public-resume");
    const reader = new CuaDriverDaemonClient(() => runtime.socketPath(), admission);
    try {
      await Effect.runPromise(reader.listWindows());
      await Effect.runPromise(runtime.stop());
      await Effect.runPromise(admission.enterPrivate());
      assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(reader.listWindows()))));
      await Effect.runPromise(admission.finishPrivateExit());
    } finally {
      await Effect.runPromise(reader.close());
    }
    record("native-daemon-query");
    await delayedStartCase(root, native, admission, executable);
    record("native-delayed-start");
    await Effect.runPromise(runtime.start());
    const uncertainId = randomUUID();
    await Effect.runPromise(
      native.begin(uncertainId, "cua_runtime", () =>
        runtime.stop().pipe(
          Effect.mapError(() => new PrivatePlanningError({ code: "privacy_busy" })),
          Effect.andThen(Effect.fail(new PrivatePlanningError({ code: "privacy_busy" }))),
        ),
      ),
    );
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(native.stopOwnedActivity(uncertainId)))));
    assert.equal(native.blockers().find((item) => item.id === uncertainId)?.state, "uncertain");
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(admission.enterPrivate()))));
    await Effect.runPromise(native.finish(uncertainId));
    record("native-uncertain-stop");
    await queuedInputCase(root, native, admission, executable);
    record("native-queued-input");
    const remoteDigests = await remoteRuntimeCase(root, native, admission);
    record("native-remote-runtime");
    await reconciliationCase(root, executable);
    record("native-restart-reconciliation");
    await unexpectedExitCase(root, executable);
    record("native-unexpected-exit");

    return {
      cases,
      nativeRuntime: {
        driverDigest: digest,
        driverVersion: lock.version,
        displayBackend: "x11",
        osMajor,
        kernelRelease: release(),
        executionEnvironment: release().includes("orbstack") ? "orbstack-vm" : "linux-host",
        remoteDigests,
      },
    };
  } finally {
    direct?.destroy();
    if (client) await client.close();
    await Effect.runPromise(runtime.stop());
  }
}

async function delayedStartCase(
  root: string,
  native: ReturnType<typeof nativePlanningFixture>["native"],
  admission: ReturnType<typeof nativePlanningFixture>["admission"],
  executable: string,
): Promise<void> {
  const started = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const directory = join("/tmp", `d-${root.split("/").at(-3)?.slice(0, 8) ?? process.pid}`);
  const runtime = new CuaDriverRuntime({
    privatePlanningNative: native,
    executable,
    endpoint: { kind: "unix-socket", directory },
    supported: true,
    hostBundleId: "openbot.planning.delayed-proof",
    platform: "linux",
    waitForSocket: async () => {
      started.resolve();
      await ready.promise;
    },
  });
  const first = Effect.runPromise(runtime.start());
  await started.promise;
  const stop = Effect.runPromise(runtime.stop());
  const queued = Effect.runPromise(runtime.start());
  try {
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(admission.enterPrivate()))));
    ready.resolve();
    const results = await Promise.allSettled([first, stop, queued]);
    assert.ok(
      results.every((result) => result.status === "fulfilled"),
      "A queued native start lost its owned lifetime.",
    );
    assert.equal(runtime.running(), true);
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(admission.enterPrivate()))));
  } finally {
    ready.resolve();
    await Promise.allSettled([first, stop, queued]);
    await Effect.runPromise(runtime.stop());
  }
}

const inputMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), pid: z.number().int().positive(), windowId: z.number().int().positive() }),
  z.object({ kind: z.literal("first_key") }),
  z.object({
    kind: z.literal("fence"),
    count: z.number().int().nonnegative(),
    privateCount: z.number().int().nonnegative(),
  }),
]);
async function queuedInputCase(
  root: string,
  native: ReturnType<typeof nativePlanningFixture>["native"],
  admission: ReturnType<typeof nativePlanningFixture>["admission"],
  executable: string,
): Promise<void> {
  const receiver = spawn("python3", [join(import.meta.dirname, "x11-input-probe.py")], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: receiver.stdout });
  const messages: Array<z.infer<typeof inputMessage>> = [];
  let decodeFailure: unknown;
  lines.on("line", (line) => {
    try {
      messages.push(inputMessage.parse(JSON.parse(line)));
    } catch (cause) {
      decodeFailure = cause;
    }
  });
  receiver.stdin.on("error", () => {});
  const next = async () => {
    while (messages.length === 0) {
      if (decodeFailure) throw new Error("Invalid input probe response.");
      await once(lines, "line", { signal: AbortSignal.timeout(15000) });
    }
    const message = messages.shift();
    assert.ok(message);
    return message;
  };
  const directory = join("/tmp", `q-${root.split("/").at(-3)?.slice(0, 8) ?? process.pid}`);
  const runtime = new CuaDriverRuntime({
    privatePlanningNative: native,
    executable,
    endpoint: { kind: "unix-socket", directory },
    supported: true,
    hostBundleId: "openbot.planning.input-proof",
    platform: "linux",
  });
  const client = new Client({ name: "planning-input-proof", version: "1" });
  let failure: unknown;
  try {
    const target = await next();
    assert.equal(target.kind, "ready");
    if (target.kind !== "ready") throw new Error("Invalid input receiver.");
    await Effect.runPromise(runtime.start());
    await client.connect(
      new StdioClientTransport({
        command: executable,
        args: ["mcp", "--socket", runtime.tapAddress()],
        env: {
          ...getDefaultEnvironment(),
          ...CUA_DRIVER_VENDOR_CALLS_OFF,
          DISPLAY: process.env.DISPLAY ?? "",
          CUA_DRIVER_EMBEDDED: "1",
        },
      }),
    );
    let settled = false;
    const typing = client
      .callTool({
        name: "type_text",
        arguments: { pid: target.pid, window_id: target.windowId, delivery_mode: "foreground", text: "q".repeat(8192) },
      })
      .then(
        (result) => {
          settled = true;
          const value = result.structuredContent;
          logger.info("Native input result.", {
            isError: result.isError === true,
            effect: isDynamicRecord(value) ? value.effect : null,
            code: isDynamicRecord(value) ? value.code : null,
            hint: isDynamicRecord(value) && typeof value.hint === "string" ? value.hint.slice(0, 512) : null,
            message: isDynamicRecord(value) && typeof value.message === "string" ? value.message.slice(0, 512) : null,
          });
        },
        () => {
          settled = true;
        },
      );
    assert.equal((await next()).kind, "first_key");
    assert.equal(settled, false, "The input call did not remain queued for the stop probe.");
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(admission.enterPrivate()))));
    await Effect.runPromise(runtime.stop());
    await typing;
    await Effect.runPromise(admission.enterPrivate());
    receiver.stdin.write("private\n");
    const fence = await next();
    assert.equal(fence.kind, "fence");
    const stale = await client
      .callTool({
        name: "type_text",
        arguments: {
          pid: target.pid,
          window_id: target.windowId,
          delivery_mode: "foreground",
          text: "PRIVATE-MUST-NOT-ARRIVE",
        },
      })
      .catch(() => null);
    assert.ok(stale === null || stale.isError === true);
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(runtime.start()))));
    receiver.stdin.write("fence\n");
    const after = await next();
    assert.equal(after.kind, "fence");
    if (after.kind !== "fence" || fence.kind !== "fence") throw new Error("Invalid input fence.");
    assert.equal(after.privateCount, 0);
    assert.equal(after.count, fence.count);
    await Effect.runPromise(admission.finishPrivateExit());
    receiver.stdin.write("public\n");
    assert.equal((await next()).kind, "fence");
  } catch (cause) {
    failure = cause;
  } finally {
    const cleanup = await Promise.allSettled([
      client.close(),
      Effect.runPromise(runtime.stop()),
      stopInputReceiver(receiver),
    ]);
    const errors = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length > 0)
      failure = new AggregateError(failure ? [failure, ...errors] : errors, "Native input cleanup failed.");
    lines.close();
  }
  if (failure) throw failure;
}
async function stopInputReceiver(receiver: ReturnType<typeof spawn>): Promise<void> {
  if (receiver.exitCode !== null || receiver.signalCode !== null) return;
  receiver.stdin?.end("stop\n");
  try {
    await once(receiver, "exit", { signal: AbortSignal.timeout(15000) });
  } catch (cause) {
    const killed = once(receiver, "exit", { signal: AbortSignal.timeout(2000) });
    receiver.kill("SIGKILL");
    await killed;
    throw cause;
  }
}
async function remoteRuntimeCase(
  root: string,
  native: ReturnType<typeof nativePlanningFixture>["native"],
  admission: ReturnType<typeof nativePlanningFixture>["admission"],
): Promise<{ sunshine: string; moonlightWebServer: string; moonlightStreamer: string }> {
  const paths = await Effect.runPromise(
    resolveRemoteDesktopRuntime({
      isPackaged: false,
      resourcesPath: "",
      sourceRoot: process.cwd(),
      platform: "linux",
      architecture: process.arch,
    }),
  );
  assert.ok(paths, "No pinned native remote runtime is installed for this architecture.");
  assert.equal(process.arch, "x64", "No pinned remote runtime is available for this architecture.");
  await verifyRuntimeTree(resolve("build/remote-desktop-runtime"), "linux-x64", await loadNativeRuntimeLock());
  const gateway = new RemoteScreenGateway({
    privatePlanningNative: native,
    platform: "linux",
    sessionEnvironment: { DISPLAY: process.env.DISPLAY, XDG_SESSION_TYPE: "x11" },
    unattended: false,
    runtimePaths: paths,
    runtimeStateDirectory: join(root, "remote-runtime"),
    getRuntimeCredentials: () => Effect.succeed({ username: "planning-proof", password: "synthetic-planning-runtime" }),
    getDisplays: () => [{ id: "0", label: "Synthetic Xvfb", width: 1280, height: 800, primary: true }],
    getIceServers: () => Effect.succeed([]),
  });
  try {
    const session = await Effect.runPromise(gateway.createLocalTestSession());
    assert.equal(gateway.list().length, 1);
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(admission.enterPrivate()))));
    const blocker = native.blockers().find((item) => item.kind === "remote_screen_runtime");
    assert.ok(blocker);
    await Effect.runPromise(native.stopOwnedActivity(blocker.id));
    assert.equal(gateway.list().length, 0);
    await Effect.runPromise(admission.enterPrivate());
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(gateway.createLocalTestSession()))));
    assert.equal(gateway.list().length, 0);
    await Effect.runPromise(admission.finishPrivateExit());
    const resumed = await Effect.runPromise(gateway.createLocalTestSession());
    assert.notEqual(resumed.id, session.id);
    assert.equal(gateway.list().length, 1);
    return {
      sunshine: createHash("sha256")
        .update(await readFile(paths.sunshine))
        .digest("hex"),
      moonlightWebServer: createHash("sha256")
        .update(await readFile(paths.moonlightWebServer))
        .digest("hex"),
      moonlightStreamer: createHash("sha256")
        .update(await readFile(paths.moonlightStreamer))
        .digest("hex"),
    };
  } finally {
    await Effect.runPromise(gateway.stop());
  }
}

async function reconciliationCase(root: string, executable: string): Promise<void> {
  const stateDirectory = join(root, "reconcile-state");
  const directory = join("/tmp", `r-${root.split("/").at(-3)?.slice(0, 8) ?? process.pid}`);
  const first = nativePlanningFixture(stateDirectory, () => [join(directory, "driver.sock")]);
  const next = nativePlanningFixture(stateDirectory, () => [join(directory, "driver.sock")]);
  const runtime = new CuaDriverRuntime({
    privatePlanningNative: first.native,
    executable,
    endpoint: { kind: "unix-socket", directory },
    supported: true,
    hostBundleId: "openbot.planning.recovery-proof",
    platform: "linux",
  });
  try {
    await Effect.runPromise(runtime.start());
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(next.admission.enterPrivate()))));
    await Effect.runPromise(runtime.stop());
    await Effect.runPromise(next.admission.enterPrivate());
    await Effect.runPromise(next.admission.finishPrivateExit());
    const malformed = join(stateDirectory, `${randomUUID()}.json`);
    await writeFile(malformed, JSON.stringify({ version: 1, bootId: "not-a-boot-id", groups: [1] }));
    assert.ok(
      Result.isFailure(await Effect.runPromise(Effect.result(next.admission.enterPrivate()))),
      "Unknown native ownership must not be repaired as a previous boot.",
    );
    assert.ok(await readFile(malformed));
  } finally {
    await Effect.runPromise(runtime.stop());
  }
}
async function unexpectedExitCase(root: string, executable: string): Promise<void> {
  const fixture = nativePlanningFixture(join(root, "exit-state"));
  const directory = join("/tmp", `e-${root.split("/").at(-3)?.slice(0, 8) ?? process.pid}`);
  const owned: { child: ReturnType<typeof spawn> | null } = { child: null };
  const runtime = new CuaDriverRuntime({
    privatePlanningNative: fixture.native,
    executable,
    endpoint: { kind: "unix-socket", directory },
    supported: true,
    hostBundleId: "openbot.planning.exit-proof",
    platform: "linux",
    spawnProcess: (command, args, options) => {
      const child = spawn(command, args, options);
      owned.child = child;
      return child;
    },
  });
  try {
    await Effect.runPromise(runtime.start());
    const child = owned.child;
    assert.ok(child);
    const exited = once(child, "exit", { signal: AbortSignal.timeout(30000) });
    child.kill("SIGKILL");
    await exited;
    assert.equal(runtime.running(), false);
    assert.equal(fixture.native.blockers()[0]?.state, "uncertain");
    assert.ok(Result.isFailure(await Effect.runPromise(Effect.result(fixture.admission.enterPrivate()))));
    const blocker = fixture.native.blockers()[0];
    assert.ok(blocker);
    await Effect.runPromise(fixture.native.stopOwnedActivity(blocker.id));
    await Effect.runPromise(fixture.admission.enterPrivate());
    await Effect.runPromise(fixture.admission.finishPrivateExit());
  } finally {
    await Effect.runPromise(runtime.stop());
  }
}
