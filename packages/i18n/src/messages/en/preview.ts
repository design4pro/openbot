import { defineMessages } from "../../message";

export const messages = defineMessages("preview", {
  "preview.openCopy": "Open copy",
  "preview.openCopyHint": "Changes in the external app do not change the original file.",
  "preview.panel.label": "File preview",
  "preview.panel.resize": "Resize file preview",
  "preview.panel.copy": "Copy file text",
  "preview.panel.download": "Download file",
  "preview.panel.reveal": "Show file in Finder",
  "preview.panel.close": "Close file preview",
  "preview.panel.back": "Back",
  "preview.panel.rawMarkdown": "Show Markdown source",
  "preview.panel.rawHtml": "Show HTML source",
  "preview.panel.wrapLines": "Wrap long lines",
  "preview.folder.empty": "This folder is empty.",
  "preview.folder.truncated": "Only the first {limit} items are shown.",
  "preview.truncated": "Preview truncated after {limit} characters.",
  "preview.unavailable": "Preview unavailable.",
  "preview.unsupported.title": "Preview unavailable",
  "preview.unsupported.description": "This file type can be opened in its default application.",
  "preview.spreadsheet.readFailed": "Could not read this spreadsheet.",
  "preview.spreadsheet.truncated": "Preview limited to the first {rows} rows and {columns} columns.",
});
