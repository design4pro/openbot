import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export type WorkPort = Pick<OpenBotDesktopApi, "localPlanning">;

/** Read at the adapter boundary so preview and isolated app fixtures can supply the same contract. */
export function workPort(): WorkPort {
  return window.openbot;
}
