import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";

/** Resolve real attachment metadata, then replace its file before the delivery adapter opens it. */
export async function applicationFileRaceCases(
  main: InspectorClient,
  page: Page,
  record: (id: string) => void,
): Promise<void> {
  await main.evaluate(
    `(async()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const f=__planningFixture;f.raceAttachment=await E.runPromise(f.services.mailbox.storeGeneratedAttachment({bytes:Buffer.from("ordinary protocol bytes"),name:"planning-race.txt",mimeType:"text/plain"}));f.raceSource=(await E.runPromise(f.services.mailbox.resolveAttachment(f.raceAttachment.id))).path;f.raceOriginalResolve=f.services.mailbox.resolveAttachment;return true;})()`,
  );
  const protocolRead = () =>
    main.evaluate(
      `(async()=>{const e=require("electron");const f=__planningFixture;const reply=await e.session.defaultSession.fetch("openbot-attachment://local/"+f.raceAttachment.id);const bytes=Buffer.from(await reply.arrayBuffer());return {status:reply.status,ordinary:bytes.equals(Buffer.from("ordinary protocol bytes"))};})()`,
    );
  try {
    assert.deepEqual(await protocolRead(), { status: 200, ordinary: true });
    record("app-managed-protocol-control");
    await main.evaluate(
      `(()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const f=__planningFixture;f.services.mailbox.resolveAttachment=function(id){return f.raceOriginalResolve.call(this,id).pipe(E.tap(value=>id===f.raceAttachment.id&&value?E.promise(async()=>{await fs.rename(value.path,value.path+".before");await fs.link(f.fileFixture.database,value.path);}):E.void));};return true;})()`,
    );
    assert.deepEqual(await protocolRead(), { status: 404, ordinary: false });
    record("app-managed-protocol-replacement");
    await restore(main);

    // Observe the actual backup staging directory after a completed copy. Linux has no ditto;
    // this observation precedes compression and does not claim a successful Linux backup archive.
    for (const race of [false, true]) {
      await main.evaluate(
        `(()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const sync=require("node:fs");const p=require("node:path");const tmp=require("node:os").tmpdir();const e=require("electron");const f=__planningFixture;f.raceOriginalList=f.services.mailbox.listExportAttachments;f.raceOriginalDialog=e.dialog.showSaveDialog;f.raceBackup=p.join(f.fileFixture.profile,"planning-backup-race.zip");e.dialog.showSaveDialog=async()=>({canceled:false,filePath:f.raceBackup});f.raceCopied=null;f.raceTmpBefore=new Set(sync.readdirSync(tmp));f.services.mailbox.listExportAttachments=function(){return f.raceOriginalList.call(this).pipe(E.tap(files=>${race}?E.promise(async()=>{const item=files.find(file=>file.sourcePath===f.raceSource);if(!item)throw new Error("Missing real generated attachment");await fs.rename(item.sourcePath,item.sourcePath+".before");await fs.link(f.fileFixture.database,item.sourcePath);}):E.void),E.map(files=>{const list=[...files];list[Symbol.iterator]=function*(){for(const item of files){yield item;if(item.sourcePath===f.raceSource){const roots=sync.readdirSync(tmp).filter(name=>name.startsWith("openbot-export-")&&!f.raceTmpBefore.has(name));if(roots.length!==1)throw new Error("Ambiguous owned backup staging directory");const bytes=sync.readFileSync(p.join(tmp,roots[0],"OpenBot Backup",item.relativePath));f.raceCopied=bytes.equals(Buffer.from("ordinary protocol bytes"))?"ordinary":"protected";}}};return list;}));};return true;})()`,
      );
      await page.evaluate(() => window.openbot.maintenance.exportData()).catch(() => undefined);
      const observation = z
        .object({ copied: z.enum(["ordinary", "protected"]).nullable(), published: z.boolean() })
        .parse(
          await main.evaluate(
            `(()=>{const f=__planningFixture;return {copied:f.raceCopied,published:require("node:fs").existsSync(f.raceBackup)};})()`,
          ),
        );
      assert.equal(observation.copied, race ? null : "ordinary");
      if (race) assert.equal(observation.published, false);
      record(race ? "app-backup-replacement" : "app-backup-copy-control");
      await restore(main);
    }
  } finally {
    await restore(main);
  }
}

async function restore(main: InspectorClient): Promise<void> {
  await main.evaluate(
    `(async()=>{const fs=require("node:fs/promises");const f=__planningFixture;if(f.raceOriginalResolve)f.services.mailbox.resolveAttachment=f.raceOriginalResolve;if(f.raceOriginalList){f.services.mailbox.listExportAttachments=f.raceOriginalList;f.raceOriginalList=null;}if(f.raceOriginalDialog){require("electron").dialog.showSaveDialog=f.raceOriginalDialog;f.raceOriginalDialog=null;}if(f.raceSource&&await fs.stat(f.raceSource+".before").catch(()=>null)){await fs.rm(f.raceSource,{force:true});await fs.rename(f.raceSource+".before",f.raceSource);}if(f.raceBackup)await fs.rm(f.raceBackup,{force:true});return true;})()`,
  );
}
