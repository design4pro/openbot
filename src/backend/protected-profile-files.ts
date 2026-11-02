import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { type FileHandle, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";

export class ProtectedProfileFileError extends Schema.TaggedError<ProtectedProfileFileError>()(
  "ProtectedProfileFileError",
  { code: Schema.Literal("protected_profile_file"), message: Schema.String, cause: Schema.Defect() },
) {}

function refused(cause: unknown = new Error(sourceText("error.storage.protectedFile"))): ProtectedProfileFileError {
  return new ProtectedProfileFileError({
    cause,
    code: "protected_profile_file",
    message: sourceText("error.storage.protectedFile"),
  });
}

/** Owns the application transfer exclusion for this profile's live database and SQLite companions. */
export class ProtectedProfileFiles {
  readonly #databasePath: string;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
  }

  #withAllowedFile<A>(path: string, use: (file: FileHandle) => Effect.Effect<A, ProtectedProfileFileError>) {
    return Effect.acquireUseRelease(
      Effect.tryPromise({ try: () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW), catch: refused }),
      (file) =>
        Effect.gen({ self: this }, function* () {
          const metadata = yield* Effect.tryPromise({ try: () => file.stat(), catch: refused });
          if (!metadata.isFile()) return yield* refused();
          yield* this.assertOpenedFileAllowed(path, metadata);
          return yield* use(file);
        }),
      (file) => Effect.tryPromise({ try: () => file.close(), catch: refused }).pipe(Effect.orDie),
    );
  }

  readAllowedFile(path: string) {
    return this.#withAllowedFile(path, (file) => Effect.tryPromise({ try: () => file.readFile(), catch: refused }));
  }

  sha256AllowedFile(path: string) {
    return this.#withAllowedFile(path, (file) =>
      Effect.tryPromise({
        try: async () => {
          const hash = createHash("sha256");
          for await (const bytes of file.createReadStream()) hash.update(bytes);
          return hash.digest("hex");
        },
        catch: refused,
      }),
    );
  }

  copyAllowedFile(path: string, target: string, exclusive = false) {
    return this.#withAllowedFile(path, (source) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () =>
            open(
              target,
              constants.O_WRONLY | constants.O_CREAT | (exclusive ? constants.O_EXCL : constants.O_TRUNC),
              0o600,
            ),
          catch: refused,
        }),
        (destination) =>
          Effect.tryPromise({
            try: (signal) => pipeline(source.createReadStream(), destination.createWriteStream(), { signal }),
            catch: refused,
          }),
        (destination) => Effect.tryPromise({ try: () => destination.close(), catch: refused }).pipe(Effect.orDie),
      ),
    );
  }

  readonly assertPathAllowed = Effect.fn("ProtectedProfileFiles.assertPathAllowed")(
    function* (this: ProtectedProfileFiles, path: string) {
      const metadata = yield* Effect.tryPromise({ try: () => stat(path), catch: refused });
      yield* this.assertOpenedFileAllowed(path, metadata);
    },
    Effect.catch((failure) => {
      const cause = failure.cause;
      // Missing-file rows still belong in storage views. This never authorizes an actual file read.
      return cause instanceof Error && "code" in cause && cause.code === "ENOENT" ? Effect.void : Effect.fail(failure);
    }),
  );

  readonly assertOpenedFileAllowed = Effect.fn("ProtectedProfileFiles.assertOpenedFileAllowed")(function* (
    this: ProtectedProfileFiles,
    path: string,
    metadata: Stats,
  ) {
    const allowed = yield* Effect.tryPromise({
      try: async () => {
        const root = await realpath(dirname(this.#databasePath));
        const database = join(root, basename(this.#databasePath));
        const protectedPaths = [database, `${database}-wal`, `${database}-shm`, `${database}-journal`];
        const resolved = await realpath(path);
        if (protectedPaths.includes(resolved)) return false;
        for (const protectedPath of protectedPaths) {
          const protectedMetadata = await stat(protectedPath).catch((error: unknown) => {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
            throw error;
          });
          if (protectedMetadata && protectedMetadata.dev === metadata.dev && protectedMetadata.ino === metadata.ino)
            return false;
        }
        return true;
      },
      catch: refused,
    });
    if (!allowed) return yield* refused();
  });
}
