import type { components, operations } from "./schema.gen.js";

type Doc = components["schemas"]["Document"];
const nullable: Doc = { id: "book", title: null, author: null };
// @ts-expect-error nullable metadata is required, not omitted
const omitted: Doc = { id: "book" };
// @ts-expect-error database paths are not public DTO fields
const leaking: Doc = { id: "book", title: null, author: null, basepath: "/private" };
// @ts-expect-error revisions are opaque strings, not JS numbers
const receipt: components["schemas"]["Receipt"] = { event_id: "e", kind: "progress", revision: 1 };
const file: operations["uploadDocument"]["requestBody"]["content"]["multipart/form-data"] = { file: new Blob() };
// @ts-expect-error binary generation maps to Blob, not a path string
const badFile: operations["uploadDocument"]["requestBody"]["content"]["multipart/form-data"] = { file: "/private/file.epub" };
void [nullable, omitted, leaking, receipt, file, badFile];
