import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";

const kinds = [
  "workspace-preview",
  "shared-preview",
  "workspace-save",
  "shared-save",
  "attachment-save",
  "archive",
  "workspace-open",
  "shared-open",
  "attachment-open",
] as const;
type Kind = (typeof kinds)[number];
const resultSchema = z.object({ rejected: z.boolean(), ordinary: z.boolean() });

/** Actual local IPC consumers; the OS opener is observed at its final external-process port. */
export async function attachmentReadCases(
  main: InspectorClient,
  page: Page,
  record: (id: string) => void,
): Promise<void> {
  const fixture = z
    .object({
      agentId: z.string(),
      ordinary: z.string(),
      shared: z.string(),
      attachmentId: z.string(),
      attachmentIds: z.array(z.string()),
    })
    .parse(
      await main.evaluate(
        `(async()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const p=require("node:path");const uuid=require("node:crypto").randomUUID;const electron=require("electron");const node=require("node:module");const f=__planningFixture;const file=f.fileFixture;const shared=p.join(file.shared,"ordinary-ipc-"+uuid()+".txt");await fs.writeFile(shared,"ordinary application file bytes");const attachment=await E.runPromise(f.services.mailbox.storeGeneratedAttachment({bytes:Buffer.from("ordinary application file bytes"),name:"ordinary-ipc.txt",mimeType:"text/plain"}));const attachmentIds=[attachment.id];for(let index=1;index<3;index++)attachmentIds.push((await E.runPromise(f.services.mailbox.storeGeneratedAttachment({bytes:Buffer.from("ordinary application file bytes"),name:"ordinary-ipc-"+index+".txt",mimeType:"text/plain"}))).id);const resolved=await E.runPromise(f.services.mailbox.resolveAttachment(attachment.id));f.localReadFixture={agentId:file.agentId,ordinary:file.ordinary,shared,attachmentId:attachment.id,attachmentIds,attachmentPath:resolved.path,destination:p.join(file.profile,"ipc-copy-"+uuid()+".txt")};f.originalLocalResolve=f.services.service.resolveLocalWorkspaceFile;f.originalSharedResolve=f.services.service.resolveSharedFile;f.originalAttachmentResolve=f.services.mailbox.resolveAttachment;f.originalReadDialog=electron.dialog.showSaveDialog;f.originalShellOpen=electron.shell.openPath;const originalRead=fs.readFile;f.originalRawRead=originalRead;fs.readFile=async(...args)=>{const bytes=await originalRead(...args);if(f.readTestActive&&args[0]===f.readSource&&Buffer.isBuffer(bytes)&&bytes.subarray(0,16).equals(Buffer.from("SQLite format 3\\0"))){f.readLeak=true;throw new Error("A protected source read was observed.");}return bytes;};node.syncBuiltinESMExports();electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:f.localReadFixture.destination});electron.shell.openPath=async path=>{if(f.readRace==="handoff")await f.replaceReadSource();const bytes=await fs.readFile(path);f.lastOpened={path,ordinary:bytes.equals(Buffer.from("ordinary application file bytes"))};return "";};f.replaceReadSource=async()=>{if(!f.readArmed)return;f.readArmed=false;await fs.rename(f.readSource,f.readSource+".before");await fs.link(file.database,f.readSource);};return f.localReadFixture;})()`,
      ),
    );
  async function prepare(kind: Kind, race: boolean): Promise<void> {
    await main.evaluate(
      `(()=>{const E=require("effect").Effect;const f=__planningFixture;const kind=${JSON.stringify(kind)};f.readSource=kind.startsWith("workspace")?f.localReadFixture.ordinary:kind.startsWith("shared")?f.localReadFixture.shared:f.localReadFixture.attachmentPath;f.readArmed=${race};f.readTestActive=${race};f.readLeak=false;f.readRace=${JSON.stringify(kind.endsWith("open") ? "handoff" : "resolve")};f.lastOpened=null;const decorate=effect=>effect.pipe(E.tap(()=>f.readRace==="resolve"?E.promise(()=>f.replaceReadSource()):E.void));f.services.service.resolveLocalWorkspaceFile=function(...args){return decorate(f.originalLocalResolve.apply(this,args));};f.services.service.resolveSharedFile=function(...args){return decorate(f.originalSharedResolve.apply(this,args));};f.services.mailbox.resolveAttachment=function(...args){return decorate(f.originalAttachmentResolve.apply(this,args));};return true;})()`,
    );
  }
  async function restore(): Promise<void> {
    await main.evaluate(
      `(async()=>{const fs=require("node:fs/promises");const f=__planningFixture;f.services.service.resolveLocalWorkspaceFile=f.originalLocalResolve;f.services.service.resolveSharedFile=f.originalSharedResolve;f.services.mailbox.resolveAttachment=f.originalAttachmentResolve;if(f.readSource&&await fs.stat(f.readSource+".before").catch(()=>null)){await fs.rm(f.readSource,{force:true});await fs.rename(f.readSource+".before",f.readSource);}await fs.rm(f.localReadFixture.destination,{force:true});return true;})()`,
    );
  }
  async function call(kind: Kind): Promise<{ rejected: boolean; ordinary: boolean }> {
    const reply = await page.evaluate(
      async ({ kind, fixture }) => {
        try {
          if (kind.endsWith("preview")) {
            const result =
              kind === "workspace-preview"
                ? await window.openbot.agent.previewWorkspaceFile(
                    { agentId: fixture.agentId, path: fixture.ordinary },
                    "local",
                  )
                : await window.openbot.agent.previewSharedFile({ path: fixture.shared }, "local");
            const ordinary =
              result.bytes !== null &&
              result.bytes.byteLength < 128 &&
              new TextDecoder().decode(result.bytes) === "ordinary application file bytes";
            if (result.pageUrl) await window.openbot.agent.releaseFilePreview(result.pageUrl);
            return { rejected: false, ordinary };
          }
          if (kind === "archive")
            await window.openbot.agent.downloadAttachments(
              { attachments: fixture.attachmentIds.map((id, index) => ({ id, name: `ordinary-ipc-${index}.txt` })) },
              "local",
            );
          else if (kind.startsWith("workspace"))
            await window.openbot.agent.openWorkspaceFile(
              { agentId: fixture.agentId, path: fixture.ordinary, action: kind.endsWith("save") ? "download" : "open" },
              "local",
            );
          else if (kind.startsWith("shared"))
            await window.openbot.agent.openSharedFile(
              { path: fixture.shared, action: kind.endsWith("save") ? "download" : "open" },
              "local",
            );
          else
            await window.openbot.agent.openAttachment(
              { attachmentId: fixture.attachmentId, action: kind.endsWith("save") ? "download" : "open" },
              "local",
            );
          return { rejected: false, ordinary: false };
        } catch {
          return { rejected: true, ordinary: false };
        }
      },
      { kind, fixture },
    );
    if (kind.endsWith("preview") || reply.rejected) return resultSchema.parse(reply);
    const ordinary = z
      .boolean()
      .parse(
        await main.evaluate(
          `(async()=>{const fs=require("node:fs/promises");const unzip=require("fflate").unzipSync;const f=__planningFixture;if(${JSON.stringify(kind)}.endsWith("open"))return f.lastOpened?.ordinary===true;let bytes=await fs.readFile(f.localReadFixture.destination);if(${JSON.stringify(kind)}==="archive"){const files=Object.values(unzip(bytes));return files.length===3&&files.every(bytes=>Buffer.from(bytes).equals(Buffer.from("ordinary application file bytes")));}return bytes.equals(Buffer.from("ordinary application file bytes"));})()`,
        ),
      );
    return { rejected: false, ordinary };
  }
  try {
    for (const kind of kinds) {
      await prepare(kind, false);
      assert.deepEqual(await call(kind), { rejected: false, ordinary: true }, `Ordinary ${kind} must still work.`);
      await restore();
      record(`app-local-${kind}-control`);
    }
    const refused: boolean[] = [];
    for (const kind of kinds) {
      process.stdout.write(`Local replacement case: ${kind}\n`);
      await prepare(kind, true);
      const result = await call(kind);
      const destinationAbsent = z
        .boolean()
        .parse(
          await main.evaluate(
            `require("node:fs/promises").stat(__planningFixture.localReadFixture.destination).then(()=>false,()=>true)`,
          ),
        );
      const protectedRead = await main.evaluate("__planningFixture.readLeak");
      refused.push(
        !protectedRead &&
          (kind.endsWith("open") ? result.rejected || result.ordinary : result.rejected && destinationAbsent),
      );
      await restore();
    }
    assert.deepEqual(
      refused,
      kinds.map(() => true),
      "Every local final consumer must refuse or hand off only an ordinary checked copy.",
    );
    for (const kind of kinds) record(`app-local-${kind}-replacement`);
  } finally {
    await restore();
    await main.evaluate(
      `(async()=>{const fs=require("node:fs/promises");const e=require("electron");const node=require("node:module");const f=__planningFixture;fs.readFile=f.originalRawRead;node.syncBuiltinESMExports();e.dialog.showSaveDialog=f.originalReadDialog;e.shell.openPath=f.originalShellOpen;await fs.rm(f.localReadFixture.shared,{force:true});return true;})()`,
    );
  }
}
