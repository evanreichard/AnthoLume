-- name: GetStorageRoot :one
SELECT id, label, path, managed, legacy_path
FROM storage_roots WHERE id = ?;

-- name: ListStorageRootsWithBookCounts :many
SELECT storage_roots.id, label, path, managed, legacy_path,
       CAST(COALESCE(book_counts.total, 0) AS INTEGER) AS book_count
FROM storage_roots
LEFT JOIN (
    SELECT COALESCE(storage_root_id, 'library') AS root_id, COUNT(*) AS total
    FROM documents WHERE NOT deleted AND filepath IS NOT NULL GROUP BY 1
) AS book_counts ON book_counts.root_id = storage_roots.id
ORDER BY id <> 'library', label, id;

-- name: UpsertStorageRoot :exec
INSERT INTO storage_roots (id, label, path, managed) VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET label = excluded.label, path = excluded.path, legacy_path = NULL;

-- name: GetMakeLibraryCounts :one
SELECT
    (SELECT COUNT(*) FROM documents AS source WHERE NOT source.deleted AND source.filepath IS NOT NULL AND source.storage_root_id = sqlc.arg(root_id)) AS incoming,
    (SELECT COUNT(*) FROM documents AS library WHERE NOT library.deleted AND library.filepath IS NOT NULL AND COALESCE(library.storage_root_id, 'library') = 'library') AS outgoing,
    (SELECT COUNT(*) FROM auto_import_rules WHERE enabled AND root_id = sqlc.arg(root_id)) AS paused_rules;

-- name: HasRunningStorageJobs :one
SELECT CAST(EXISTS(SELECT 1 FROM admin_jobs WHERE status = 'running' AND deadline > ?) AS BOOLEAN);

-- name: InsertFormerLibraryRoot :exec
INSERT INTO storage_roots (id, label, path, managed) VALUES (?, 'Former Library', ?, 0);

-- name: MoveFormerLibraryDocuments :exec
UPDATE documents SET storage_root_id = ?
WHERE COALESCE(storage_root_id, 'library') = 'library' AND filepath IS NOT NULL;

-- name: SetLibraryRootPath :exec
UPDATE storage_roots SET path = ? WHERE id = 'library';

-- name: MoveDocumentsIntoLibrary :exec
UPDATE documents SET storage_root_id = 'library' WHERE storage_root_id = ?;

-- name: MovePausedImportRulesIntoLibrary :exec
UPDATE auto_import_rules SET root_id = 'library', enabled = 0, next_scan = NULL, status = 'idle' WHERE root_id = ?;

-- name: DeleteStorageRoot :exec
DELETE FROM storage_roots WHERE id = ?;

-- name: ListBackupLibraryFilepaths :many
SELECT DISTINCT filepath FROM documents
WHERE NOT deleted AND COALESCE(storage_root_id, 'library') = 'library' AND filepath IS NOT NULL
ORDER BY filepath;

-- name: CountSnapshotAdmins :one
SELECT COUNT(*) FROM users WHERE admin = 1 AND length(pass) > 0;

-- name: ListStorageRootsForRestore :many
SELECT id, label, managed FROM storage_roots ORDER BY id;

-- name: ClearSnapshotStorageRootPaths :exec
UPDATE storage_roots SET path = NULL;

-- name: SetRestoredStorageRootPath :exec
UPDATE storage_roots SET path = ?, legacy_path = NULL WHERE id = ?;

-- name: ListDocumentsForRestore :many
SELECT id, filepath, storage_root_id, coverfile, deleted FROM documents;

-- name: SetBackupDocumentPaths :exec
UPDATE documents SET filepath = ?, coverfile = ? WHERE id = ?;

-- name: SetRestoredDocumentPaths :exec
UPDATE documents SET filepath = ?, storage_root_id = ?, coverfile = ?, basepath = NULL WHERE id = ?;

-- name: PauseRestoredImportRules :exec
UPDATE auto_import_rules SET enabled = 0, next_scan = NULL, status = 'idle';

-- name: InterruptRunningAdminJobs :exec
UPDATE admin_jobs SET status = 'interrupted', finished_at = ? WHERE status = 'running';

-- name: RotateRestoredReadingGeneration :exec
INSERT INTO reading_generation (singleton, generation) VALUES (1, lower(hex(randomblob(16))))
ON CONFLICT(singleton) DO UPDATE SET generation = excluded.generation;

-- name: RelinkImportedDocument :execrows
UPDATE documents SET storage_root_id = ?, filepath = ?, md5 = ?
WHERE id = ? AND NOT deleted
  AND filepath IS sqlc.narg(old_filepath) AND storage_root_id IS sqlc.narg(old_storage_root_id);

-- name: SetLibraryImportResult :exec
UPDATE admin_jobs SET result = ? WHERE id = ? AND status = 'running';

-- name: GetSucceededLibraryImportResult :one
SELECT result FROM admin_jobs WHERE id = ? AND kind = 'import' AND status = 'succeeded';

-- name: AttachCatalogFile :execrows
INSERT INTO documents (id, md5, filepath, storage_root_id, title, author, description, words, isbn10, isbn13)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    md5 = excluded.md5, filepath = excluded.filepath, storage_root_id = excluded.storage_root_id,
    title = COALESCE(documents.title, excluded.title), author = COALESCE(documents.author, excluded.author),
    description = COALESCE(documents.description, excluded.description), words = COALESCE(documents.words, excluded.words),
    isbn10 = COALESCE(documents.isbn10, excluded.isbn10), isbn13 = COALESCE(documents.isbn13, excluded.isbn13)
WHERE NOT documents.deleted AND documents.filepath IS NULL;
