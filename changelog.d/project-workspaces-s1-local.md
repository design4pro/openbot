### Added

- Add durable profile ownership and manual local projects, milestones, tickets, drafts, and milestone reviews in Work. Keep Tasks available. Planning works without an OpenBot account on an explicitly supported private-display configuration; other configurations refuse private entry.

### Fixed

- Exclude private planning from Team APIs, agent context, normal exports, and application-mediated screen/control sessions. Protect the application database from file transfers, including alias and replacement races. This slice does not enable ticket execution, GitHub integration, or project sharing.

### Fixed

- Check local preview, save, archive, and remote upload sources at their final read. Open checked copies in external apps and explain that edits do not update the original.
- Restore public admission after a first private entry fails before a window is exposed. Preserve existing private sessions.
- Require the tested Ubuntu distribution and release for private planning.
