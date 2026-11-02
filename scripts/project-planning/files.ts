import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { link, mkdir, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result } from "effect";
import { AttachmentGateway } from "../../src/backend/agent/attachment-gateway";
import { ConversationRuntime } from "../../src/backend/agent/conversation-runtime";
import { AgentStore } from "../../src/backend/agent-store";
import { AttachmentFiles } from "../../src/backend/attachment-files";
import { MailboxStore } from "../../src/backend/mailbox-store";
import { listWorkspaceDirectory } from "../../src/backend/workspace-paths";
import { HttpError } from "../../src/main/team-api/http-error";
import { sendFile } from "../../src/main/team-api/route-files";

// Real file-opening services only. This does not certify the Electron upload or Team API wiring.
export async function fileServiceCases(root: string): Promise<string[]> {
  const profile = join(root, "profile");
  const home = join(root, "home");
  const store = new AgentStore(profile, home);
  await Effect.runPromise(store.initialize());
  const mailbox = new MailboxStore(profile, store.sharedRoot, store.database);
  await Effect.runPromise(mailbox.initialize());
  const cases: string[] = [];
  const logger = createOpenBotLogger("planning-file-services");
  const record = (id: string) => {
    cases.push(id);
    logger.info("Service case passed.", { caseId: id });
  };
  try {
    const agent = await Effect.runPromise(
      store.createAgent({ name: "File probe", description: "Synthetic", avatarSeed: "files", avatarHue: null }),
    );
    const gateway = new AttachmentGateway({
      conversation: new ConversationRuntime(
        store,
        () => undefined,
        () => store.list(),
      ),
      mailbox,
      sharedRoot: store.sharedRoot,
      protectedFiles: store.database.protectedFiles,
      hooks: { emit: () => undefined, emitError: () => undefined },
    });
    const protectedPaths = [store.database.path, `${store.database.path}-wal`, `${store.database.path}-shm`];
    for (const path of protectedPaths) {
      const result = await Effect.runPromise(
        Effect.result(gateway.openSources(agent.id, [path], { allowAnyReadablePath: true })),
      );
      if (Result.isSuccess(result)) {
        for (const source of result.success) await source.handle.close();
      }
      assert.ok(Result.isFailure(result), "Browser-upload source must refuse protected profile data");
    }
    record("protected-profile-paths");

    const hardLink = join(agent.workspacePath, "linked.sqlite");
    const symbolicLink = join(agent.workspacePath, "symbolic.sqlite");
    await link(store.database.path, hardLink);
    await symlink(store.database.path, symbolicLink);
    for (const path of [hardLink, symbolicLink]) {
      const result = await Effect.runPromise(
        Effect.result(gateway.openSources(agent.id, [path], { allowAnyReadablePath: true })),
      );
      if (Result.isSuccess(result)) for (const source of result.success) await source.handle.close();
      assert.ok(Result.isFailure(result), "An alias must not bypass protected-file checks");
    }
    record("protected-file-alias");

    const disguised = join(agent.workspacePath, "private-notes.txt");
    await link(store.database.path, disguised);
    const attachmentFiles = new AttachmentFiles({
      userDataPath: profile,
      sharedRoot: store.sharedRoot,
      protectedFiles: store.database.protectedFiles,
    });
    const draft = await Effect.runPromise(Effect.result(attachmentFiles.prepareDrafts([disguised], [])));
    assert.ok(Result.isFailure(draft), "Draft staging must not copy protected bytes under an ordinary name");
    const generated = await Effect.runPromise(
      Effect.result(attachmentFiles.storeGenerated({ sourcePath: disguised, name: "image.png" })),
    );
    assert.ok(Result.isFailure(generated), "Generated staging must not copy protected bytes");
    record("protected-staging");

    for (const path of [
      join(agent.workspacePath, "ordinary.txt"),
      join(profile, "attachment-drafts", "ordinary.txt"),
    ]) {
      await mkdir(join(profile, "attachment-drafts"), { recursive: true });
      await writeFile(path, "ordinary workspace bytes");
      const sources = await Effect.runPromise(gateway.openSources(agent.id, [path], { allowAnyReadablePath: true }));
      const source = sources[0];
      assert.ok(source);
      try {
        assert.equal(await source.handle.readFile("utf8"), "ordinary workspace bytes");
      } finally {
        await source.handle.close();
      }
    }
    const stagedOrdinary = await Effect.runPromise(
      attachmentFiles.prepareDrafts([join(agent.workspacePath, "ordinary.txt")], []),
    );
    assert.equal(stagedOrdinary.length, 1);
    const staged = stagedOrdinary[0];
    assert.ok(staged);
    const copiedBytes = await Effect.runPromise(store.database.protectedFiles.readAllowedFile(staged.path));
    assert.equal(copiedBytes.toString("utf8"), "ordinary workspace bytes");
    record("ordinary-file-control");
    const collisionSources: string[] = [];
    for (const name of ["first", "second"]) {
      const folder = join(agent.workspacePath, name);
      await mkdir(folder, { recursive: true });
      const path = join(folder, "same.txt");
      await writeFile(path, name);
      collisionSources.push(path);
    }
    const transferred = await Effect.runPromise(
      attachmentFiles.commitMessageTransfer(
        randomUUID(),
        { kind: "user" },
        [agent.id],
        randomUUID(),
        new Date().toISOString(),
        collisionSources,
      ),
    );
    assert.equal(transferred.length, 2);
    assert.notEqual(transferred[0]?.name, transferred[1]?.name);
    const contents = await Promise.all(
      transferred.map(async (item) =>
        (await Effect.runPromise(store.database.protectedFiles.readAllowedFile(item.path))).toString("utf8"),
      ),
    );
    assert.deepEqual(contents.sort(), ["first", "second"]);
    record("transfer-collision");
    const missing = join(agent.workspacePath, "missing-ordinary.txt");
    await writeFile(missing, "ordinary missing attachment");
    await rm(missing);
    const missingMetadata = await Effect.runPromise(
      Effect.result(store.database.protectedFiles.assertPathAllowed(missing)),
    );
    assert.ok(
      Result.isSuccess(missingMetadata),
      "Missing ordinary files must retain their existing missing-file projection",
    );
    record("missing-file-metadata");

    const listing = await Effect.runPromise(
      listWorkspaceDirectory({ ...agent, workspacePath: profile }, ".", {}, store.database.protectedFiles),
    );
    assert.ok(
      listing.entries.every((entry) => !["openbot.db", "openbot.db-wal", "openbot.db-shm"].includes(entry.name)),
    );
    record("overlap-workspace-list");

    const held = await open(hardLink, "r");
    try {
      const replacement = join(root, "replacement.txt");
      await writeFile(replacement, "ordinary replacement");
      await rename(replacement, hardLink);
      const result = await Effect.runPromise(
        Effect.result(store.database.protectedFiles.assertOpenedFileAllowed(hardLink, await held.stat())),
      );
      assert.ok(Result.isFailure(result), "Check the opened file identity, not its replaced name");
    } finally {
      await held.close();
    }
    record("replacement-guard");

    const server = createServer((request, response) => {
      const selected = request.url === "/ordinary" ? join(agent.workspacePath, "ordinary.txt") : store.database.path;
      void sendFile(store.database.protectedFiles, response, selected, null, (size) => ({
        "content-length": size,
      })).catch((error: unknown) => response.writeHead(error instanceof HttpError ? error.status : 500).end("refused"));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const protectedResponse = await fetch(`http://127.0.0.1:${address.port}/private`);
      assert.equal(protectedResponse.status, 404);
      assert.equal(await protectedResponse.text(), "refused");
      const ordinaryResponse = await fetch(`http://127.0.0.1:${address.port}/ordinary`);
      assert.equal(ordinaryResponse.status, 200);
      assert.equal(await ordinaryResponse.text(), "ordinary workspace bytes");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    record("file-stream-refusal");
    return cases;
  } finally {
    store.database.close();
  }
}
