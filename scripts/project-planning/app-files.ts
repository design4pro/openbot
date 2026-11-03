import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { Browser, Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { applicationFileRaceCases } from "./app-file-races";
import { loopbackConnection, privateSession, protocolHeaders, publicWindow } from "./app-fixture";
import { exposePrivate } from "./electron-cases";

/** Actual app services and browser destination. No service fixture can satisfy this group. */
export async function applicationFileCases(
  main: InspectorClient,
  browser: Browser,
  page: Page,
  record: (id: string) => void,
  privateRequired = true,
): Promise<void> {
  const connection = await loopbackConnection(main, page);
  const session = privateRequired ? await privateSession(page) : null;
  if (session) record("app-private-admission");
  const fixture = z
    .object({
      agentId: z.string(),
      workspace: z.string(),
      shared: z.string(),
      profile: z.string(),
      database: z.string(),
      ordinary: z.string(),
      ordinaryAlias: z.string(),
      aliases: z.array(z.string()),
      exportPath: z.string(),
    })
    .parse(
      await main.evaluate(
        `(async()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const p=require("node:path");const app=require("electron").app;const f=__planningFixture;const a=await E.runPromise(f.services.service.createAgentProfile({name:"Planning file fixture",description:"Disposable file evidence",avatarSeed:"planning-files",avatarHue:null}));const profile=app.getPath("userData");const database=p.join(profile,"openbot.db");const ordinary=p.join(a.workspacePath,"ordinary-${randomUUID()}.txt");await fs.writeFile(ordinary,"ordinary application file bytes");const ordinaryAlias=ordinary+".link";await fs.symlink(ordinary,ordinaryAlias);const aliases=[p.join(a.workspacePath,"db-${randomUUID()}.txt"),p.join(f.services.service.sharedRoot,"db-${randomUUID()}.txt"),p.join(a.workspacePath,"link-${randomUUID()}.txt")];await fs.link(database,aliases[0]);await fs.link(database,aliases[1]);await fs.symlink(database,aliases[2]);f.fileFixture={agentId:a.id,workspace:a.workspacePath,shared:f.services.service.sharedRoot,profile,database,ordinary,ordinaryAlias,aliases,exportPath:p.join(profile,"planning-file-proof-${randomUUID()}.zip")};return f.fileFixture;})()`,
      ),
    );
  const headers = protocolHeaders(connection.sessionToken);
  const download = (path: string) =>
    fetch(
      `${connection.apiUrl}${TEAM_API_ROUTES.workspaceFiles}?botId=${encodeURIComponent(fixture.agentId)}&path=${encodeURIComponent(path)}`,
      { headers },
    );
  const uploadReceived = Promise.withResolvers<Buffer>();
  let receivedBytes = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        receivedBytes += chunk.length;
      });
      request.on("end", () => {
        response.end("received");
        uploadReceived.resolve(Buffer.concat(chunks));
      });
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><title>Planning upload destination</title><label>Proof file<input type="file" onchange="if(this.files.length)fetch(location.href,{method:\'POST\',body:this.files[0]})"></label>',
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const ordinary = await download(fixture.ordinary);
    assert.equal(ordinary.status, 200);
    assert.equal(await ordinary.text(), "ordinary application file bytes");
    record("app-ordinary-http-control");
    for (const path of [fixture.database, `${fixture.database}-wal`, `${fixture.database}-shm`, ...fixture.aliases]) {
      const response = await download(path);
      assert.ok(response.status >= 400 && response.status < 500, "Protected HTTP downloads must be refused.");
      assert.equal(response.headers.has("content-disposition"), false);
      await response.arrayBuffer();
    }
    const shared = await fetch(
      `${connection.apiUrl}${TEAM_API_ROUTES.sharedFiles}?path=${encodeURIComponent(fixture.aliases[1] ?? "")}`,
      { headers },
    );
    assert.ok(shared.status >= 400 && shared.status < 500);
    record("app-protected-http-downloads");
    await main.evaluate(
      `(()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const f=__planningFixture;f.fileOriginalResolve=f.services.service.resolveWorkspaceFile;f.services.service.resolveWorkspaceFile=function(id,path,...rest){return f.fileOriginalResolve.call(this,id,path,...rest).pipe(E.tap(()=>path===f.fileFixture.ordinary?E.promise(async()=>{await fs.rename(path,path+".before");await fs.link(f.fileFixture.database,path);}):E.void));};return true;})()`,
    );
    const replaced = await download(fixture.ordinary);
    assert.equal(replaced.status, 404);
    assert.equal(replaced.headers.has("content-disposition"), false);
    await main.evaluate(
      `(async()=>{const fs=require("node:fs/promises");const f=__planningFixture;f.services.service.resolveWorkspaceFile=f.fileOriginalResolve;f.fileOriginalResolve=null;await fs.rm(f.fileFixture.ordinary);await fs.rename(f.fileFixture.ordinary+".before",f.fileFixture.ordinary);return true;})()`,
    );
    record("app-replacement-before-open");

    await page.evaluate(({ agentId, profile }) => window.openbot.agent.addAgentFolder({ agentId, path: profile }), {
      agentId: fixture.agentId,
      profile: fixture.profile,
    });
    const listing = await page.evaluate(
      ({ agentId, profile }) => window.openbot.agent.listWorkspaceDirectory({ agentId, path: profile }),
      { agentId: fixture.agentId, profile: fixture.profile },
    );
    assert.equal(JSON.stringify(listing).includes("openbot.db"), false);
    await page.evaluate(({ agentId, profile }) => window.openbot.agent.removeAgentFolder({ agentId, path: profile }), {
      agentId: fixture.agentId,
      profile: fixture.profile,
    });
    record("app-overlap-additional-folder");

    await exposePrivate(main, "__planningFixture.services.service", "#browserUploads", "browserUploads");
    const tabId = z
      .string()
      .parse(
        await main.evaluate(
          `(async()=>{const E=require("effect").Effect;const f=__planningFixture;f.fileThread=require("node:crypto").randomUUID();const tab=await E.runPromise(f.services.browser.open(${JSON.stringify(url)},f.fileThread,f.fileFixture.agentId,false));f.fileTab=tab.id;return tab.id;})()`,
        ),
      );
    const upload = (path: string) =>
      main.evaluate(
        `require("effect").Effect.runPromise(__planningFixture.browserUploads.uploadFiles(__planningFixture.fileFixture.agentId,{threadId:__planningFixture.fileThread,turnId:"planning-file-turn",callId:require("node:crypto").randomUUID(),ownerAgentId:__planningFixture.fileFixture.agentId,namespace:"openbot_browser",tool:"upload_files",arguments:{tabId:${JSON.stringify(tabId)},target:{kind:"css",selector:"input[type=file]"},paths:[${JSON.stringify(path)}],snapshot:false}}))`,
      );
    for (const path of [fixture.database, `${fixture.database}-wal`, `${fixture.database}-shm`, ...fixture.aliases])
      assert.equal(z.object({ success: z.boolean() }).parse(await upload(path)).success, false);
    assert.equal(receivedBytes, 0);
    record("app-browser-upload-refusal");
    assert.equal(z.object({ success: z.boolean() }).parse(await upload(fixture.ordinaryAlias)).success, true);
    assert.equal((await uploadReceived.promise).toString("utf8"), "ordinary application file bytes");
    const destination = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === url);
    assert.ok(destination);
    assert.equal(
      await destination.locator("input[type=file]").evaluate((element: HTMLInputElement) => element.files?.length),
      1,
    );
    record("app-browser-upload-control");

    const staged = await main.evaluate(
      `(async()=>{const E=require("effect").Effect;const f=__planningFixture;const refused=await E.runPromise(E.result(f.services.service.prepareAttachments([f.fileFixture.aliases[0]])));const ordinary=await E.runPromise(f.services.service.prepareAttachments([f.fileFixture.ordinaryAlias]));return {refused:refused._tag==="Failure",ordinary:ordinary.length};})()`,
    );
    assert.deepEqual(staged, { refused: true, ordinary: 1 });
    record("app-staged-transfer-refusal");
    await applicationFileRaceCases(main, page, record);
    const exported = await main.evaluate(
      `(async()=>{const E=require("effect").Effect;const f=__planningFixture;const result=await E.runPromise(E.result(f.services.instanceTransfer.exportTo(f.fileFixture.exportPath,{agentIds:[f.fileFixture.agentId],includeFiles:true,includeSettings:false})));return result._tag==="Failure";})()`,
    );
    assert.equal(exported, true);
    record("app-instance-export-refusal");
    await main.evaluate(
      `(async()=>{const f=__planningFixture;const fs=require("node:fs/promises");for(const path of f.fileFixture.aliases)await fs.rm(path);return true;})()`,
    );
    const ordinaryExport = await main.evaluate(
      `(async()=>{const E=require("effect").Effect;const f=__planningFixture;return (await E.runPromise(f.services.instanceTransfer.exportTo(f.fileFixture.exportPath,{agentIds:[f.fileFixture.agentId],includeFiles:true,includeSettings:false}))).saved;})()`,
    );
    assert.equal(ordinaryExport, true);
    record("app-instance-export-control");
    await main.evaluate(
      `require("node:fs/promises").link(__planningFixture.fileFixture.database,__planningFixture.fileFixture.aliases[0])`,
    );
    if (session) await publicWindow(main, browser, page, session);
    assert.equal((await download(fixture.ordinary)).status, 200);
    const publicDownload = await download(fixture.database);
    assert.equal(publicDownload.status, 404);
    assert.equal((await download(fixture.aliases[0] ?? "")).status, 404);
    record("app-public-mode-profile-refusal");
  } finally {
    await main
      .evaluate(
        `(async()=>{const fs=require("node:fs/promises");const f=__planningFixture;if(f.fileOriginalResolve){f.services.service.resolveWorkspaceFile=f.fileOriginalResolve;f.fileOriginalResolve=null;}const backup=f.fileFixture.ordinary+".before";if(await fs.stat(backup).catch(()=>null)){await fs.rm(f.fileFixture.ordinary,{force:true});await fs.rename(backup,f.fileFixture.ordinary);}return true;})()`,
      )
      .catch(() => undefined);
    await main
      .evaluate(
        `(async()=>{const E=require("effect").Effect;const f=__planningFixture;if(f.fileTab)await E.runPromise(f.services.browser.close(f.fileTab));return true;})()`,
      )
      .catch(() => undefined);
    await main
      .evaluate(
        `(async()=>{const fs=require("node:fs/promises");const f=__planningFixture;for(const path of [...f.fileFixture.aliases,f.fileFixture.exportPath])await fs.rm(path,{force:true});return true;})()`,
      )
      .catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close((cause) => (cause ? reject(cause) : resolve())));
  }
}
