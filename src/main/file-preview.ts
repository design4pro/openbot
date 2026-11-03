import { open } from "node:fs/promises";
import { attachmentFileExtension, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { attachmentCall, attachmentFailure } from "../backend/attachment-effects";
import type { ProtectedProfileFiles } from "../backend/protected-profile-files";
import { filePreviewPages } from "./file-preview-pages";

export function mimeTypeForName(name: string) {
  return attachmentMimeTypeForName(name);
}

export function filePreviewFromBytes(name: string, bytes: Uint8Array): FilePreview {
  if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error(sourceText("error.attachment.previewTooLarge"));
  const mimeType = mimeTypeForName(name);
  const kind = filePreviewKindForFile(name, mimeType);
  return { name, size: bytes.byteLength, mimeType, previewKind: kind, bytes: kind === "none" ? null : bytes };
}

export const localFilePreview = Effect.fn("FilePreview.local")(function* (
  protectedFiles: ProtectedProfileFiles,
  path: string,
  name: string,
  generation: number,
  maxBytes: number = ATTACHMENT_LIMITS.fileBytes,
) {
  return yield* Effect.acquireUseRelease(
    attachmentCall(() => open(path, "r")),
    (file) =>
      Effect.gen(function* () {
        const metadata = yield* attachmentCall(() => file.stat());
        if (!metadata.isFile()) return yield* attachmentFailure(new Error(sourceText("error.attachment.unavailable")));
        yield* protectedFiles.assertOpenedFileAllowed(path, metadata).pipe(Effect.mapError(attachmentFailure));
        const extension = attachmentFileExtension(name);
        const mimeType = extension === "html" || extension === "htm" ? "text/html" : mimeTypeForName(name);
        const kind =
          metadata.size > Math.min(maxBytes, ATTACHMENT_LIMITS.fileBytes)
            ? "none"
            : filePreviewKindForFile(name, mimeType);
        const bytes = kind === "none" ? null : new Uint8Array(yield* attachmentCall(() => file.readFile()));
        const pageUrl = bytes ? filePreviewPages.add(mimeType, bytes, generation) : undefined;
        return { name, size: metadata.size, mimeType, previewKind: kind, bytes, ...(pageUrl ? { pageUrl } : {}) };
      }),
    (file) => attachmentCall(() => file.close()).pipe(Effect.orDie),
  );
});
