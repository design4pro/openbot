import { defineMessages } from "../../../message";

export const messages = defineMessages("error.storage", {
  // Storage errors.
  "error.storage.protectedFile": "OpenBot cannot share private profile files.",
  "error.storage.unsupported": "Storage is not supported by this server.",
  "error.storage.agentMissing": "The agent does not exist.",
  "error.storage.unreadableFile": "OpenBot cannot read {path}. The file is damaged.",
});
