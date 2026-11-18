# Book storage and backups

Open **Settings → Administration → Library** to manage storage roots. `Library` and `Imports` are supplied automatically under the data directory. A root has a stable ID, a label, and a directory visible to the server process. In Docker, mount that directory into the container first. The directory picker shows the container’s filesystem, not the host’s.

- **Library** is the only managed root. Its default is `$DATA_PATH/documents`; an explicit path override survives restarts.
- **Add source** registers an unmanaged directory. **Reference** catalogs files in place; **Copy** saves them to Library. AnthoLume does not write into source roots or include their book files in backups.

To relocate a mount, move the files outside AnthoLume and edit the existing root to point at the new mount. Keep paths under that root unchanged; book IDs and reading history stay the same. A missing file or mount shows as unavailable. For a single moved file, re-import with **Relink missing copies** to update a matching book only when the original is unavailable and the content hash matches.

Backups always include the database, including references and history. **Database + Library files** adds cataloged Library EPUBs and covers. Missing EPUBs are reported in the estimate; untracked files are not included. Restore writes bundled EPUBs to a new directory inside Library without replacing existing files. Mount paths from the backup are not activated. References whose files aren’t available can be remapped afterward.

For a one-off import, select **Manual** in the Import card. Select **Auto** to add a named rule for a source; edit existing rules from the card’s list. To scan distinct folders, configure each as its own source root. Choose a **Cadence**. **On changes** watches the filesystem and falls back to a scan every 15 minutes. The hourly, 6-hour, 12-hour and daily presets run on a schedule without watching. Scans add books and never mirror deletions. After a restore, review the mount mappings before re-enabling schedules.

On upgrade, the configured `$DATA_PATH/documents` is Library. Other recorded base paths become sources. If a source path no longer resolves, edit that root and point it at the folder that now holds the files. To make it the managed Library, open the source and select **Make Library**, then review the confirmation. No files move. The previous Library becomes a source; if both roots already point at the same folder, only their catalog links are joined. Auto-import rules for the promoted source are paused. Restore supports the new backup format; restore an older archive on the previous release before upgrading.
