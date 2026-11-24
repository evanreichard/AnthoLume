CREATE TABLE document_identifiers (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (document_id, namespace, value)
);
CREATE INDEX document_identifiers_lookup ON document_identifiers(namespace, value);

INSERT INTO document_identifiers (document_id, namespace, value)
SELECT id, 'google_books_volume', gbid FROM documents WHERE trim(gbid, char(9,10,11,12,13,32)) <> ''
UNION ALL
SELECT id, 'openlibrary', olid FROM documents WHERE trim(olid, char(9,10,11,12,13,32)) <> '';

ALTER TABLE documents DROP COLUMN gbid;
ALTER TABLE documents DROP COLUMN olid;
