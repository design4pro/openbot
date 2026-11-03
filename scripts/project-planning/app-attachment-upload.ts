import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { exposePrivate, installSyntheticRemoteCipher } from "./electron-cases";

/** Real picker/preload file imports, production remote manager, and actual HTTP body delivery. */
export async function attachmentUploadCases(
  main: InspectorClient,
  page: Page,
  record: (id: string) => void,
): Promise<void> {
  await installSyntheticRemoteCipher(main);
  await main.evaluate(
    `(async()=>{const fs=require("node:fs/promises");const f=__planningFixture;f.ordinaryRemoteAlias=f.fileFixture.ordinary+".remote.txt";await fs.symlink(f.fileFixture.ordinary,f.ordinaryRemoteAlias);return true;})()`,
  );
  const remoteId = z
    .string()
    .parse(
      await main.evaluate(
        `(async()=>{const E=require("effect").Effect;const f=__planningFixture;const connection=await E.runPromise(f.services.host.createDevelopmentConnection());await E.runPromise(f.services.remoteServers.connectDevelopmentServer(connection));return connection.serverId;})()`,
      ),
    );
  await page.evaluate(() => window.openbot.servers.list());
  await exposePrivate(main, "__planningFixture.services.host", "#api", "apiServer");
  await exposePrivate(main, "__planningFixture.apiServer", "#server", "receivingServer");
  await main.evaluate(
    `(()=>{const f=__planningFixture;f.importDrafts=[];f.incomingUploads=[];f.uploadObserver=request=>{if(request.method!=="POST"||new URL(request.url,"http://localhost").pathname!=="/v1/attachments")return;const row={bytes:0,sqlite:false};f.incomingUploads.push(row);const emit=request.emit;let prefix=Buffer.alloc(0);request.emit=function(type,...args){if(type==="data"){const bytes=Buffer.from(args[0]);row.bytes+=bytes.length;if(prefix.length<16)prefix=Buffer.concat([prefix,bytes.subarray(0,16-prefix.length)]);row.sqlite=prefix.equals(Buffer.from("SQLite format 3\\0"));}return emit.call(this,type,...args);};};f.receivingServer.on("request",f.uploadObserver);f.originalOpenDialog=require("electron").dialog.showOpenDialog;return true;})()`,
  );
  await page.evaluate(() => {
    const label = document.createElement("label");
    label.textContent = "Privacy import fixture";
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("aria-label", "Privacy import fixture");
    input.dataset.openbotAttachmentPicker = "true";
    label.append(input);
    document.body.append(label);
  });
  const fixture = z
    .object({ ordinaryAlias: z.string(), aliases: z.array(z.string()) })
    .parse(
      await main.evaluate("({...__planningFixture.fileFixture,ordinaryAlias:__planningFixture.ordinaryRemoteAlias})"),
    );
  async function remember(ids: string[]): Promise<void> {
    await main.evaluate(`__planningFixture.importDrafts.push(...${JSON.stringify(ids)})`);
  }
  async function picker(path: string): Promise<boolean> {
    await main.evaluate(
      `require("electron").dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(path)}]})`,
    );
    try {
      const attachments = await page.evaluate(
        (serverId) => window.openbot.agent.chooseAttachments({ filter: "all" }, serverId),
        remoteId,
      );
      await remember(attachments.map((item) => item.id));
      return false;
    } catch {
      return true;
    }
  }
  async function imported(path: string): Promise<boolean> {
    const pending = await page.evaluateHandle(() => ({
      result: new Promise<{ refused: boolean; serverId: string; ids: string[] }>((resolve) => {
        const stop = window.openbot.agent.onAttachmentImport((event) => {
          if (event.type === "started") return;
          stop();
          resolve({
            refused: event.type === "error",
            serverId: event.serverId,
            ids: event.type === "completed" ? event.attachments.map((item) => item.id) : [],
          });
        });
      }),
    }));
    try {
      const cdp = await page.context().newCDPSession(page);
      try {
        const node = z.object({ result: z.object({ objectId: z.string() }) }).parse(
          await cdp.send("Runtime.evaluate", {
            expression: `document.querySelector('input[aria-label="Privacy import fixture"]')`,
          }),
        );
        await cdp.send("DOM.setFileInputFiles", { objectId: node.result.objectId, files: [path] });
      } finally {
        await cdp.detach();
      }
      const event = await pending.evaluate((value) => value.result);
      assert.equal(event.serverId, remoteId);
      await remember(event.ids);
      return event.refused;
    } finally {
      await pending.dispose();
    }
  }
  const observed = () =>
    main.evaluate("__planningFixture.incomingUploads.map(row=>({bytes:row.bytes,sqlite:row.sqlite}))");
  try {
    for (const [name, action] of [
      ["picker", picker],
      ["import", imported],
    ] as const) {
      assert.equal(await action(fixture.ordinaryAlias), false);
      const rows = z.array(z.object({ bytes: z.number(), sqlite: z.boolean() })).parse(await observed());
      assert.equal(rows.at(-1)?.bytes, Buffer.byteLength("ordinary application file bytes"));
      assert.equal(rows.at(-1)?.sqlite, false);
      record(`app-remote-${name}-control`);
    }
    const outcomes: boolean[] = [];
    for (const [action, path] of [
      [picker, fixture.aliases[0]],
      [imported, fixture.aliases[2]],
    ] as const) {
      assert.ok(path);
      const before = z.array(z.object({ bytes: z.number() })).parse(await observed()).length;
      const refused = await action(path);
      const after = z.array(z.object({ bytes: z.number() })).parse(await observed()).length;
      outcomes.push(refused && before === after);
    }
    assert.deepEqual(outcomes, [true, true], "Both remote path adapters must refuse before any destination request.");
    record("app-remote-picker-protected-refusal");
    record("app-remote-import-protected-refusal");
  } finally {
    await main.evaluate(
      `(async()=>{const E=require("effect").Effect;const fs=require("node:fs/promises");const f=__planningFixture;require("electron").dialog.showOpenDialog=f.originalOpenDialog;f.receivingServer.removeListener("request",f.uploadObserver);await fs.rm(f.ordinaryRemoteAlias,{force:true});for(const id of f.importDrafts)await E.runPromise(f.services.service.discardDraftAttachment(id));return true;})()`,
    );
    await page.getByLabel("Privacy import fixture", { exact: true }).evaluate((input) => input.parentElement?.remove());
    await page.evaluate(() => window.openbot.servers.select("local"));
  }
}
