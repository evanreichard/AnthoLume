import createClient from "openapi-fetch";
import type { components, paths } from "./schema.gen.js";

export function proofClient(baseUrl: string, csrf: string, fetcher: typeof fetch = fetch) {
  const client = createClient<paths>({ baseUrl, credentials: "same-origin", fetch: fetcher });
  return {
    documents: (page = 1) => client.GET("/api/v1/documents", {
      params: { query: { page, page_size: 9 } },
    }),
    progress: (body: components["schemas"]["ProgressEvent"], signal?: AbortSignal) =>
      client.POST("/api/v1/me/reading-progress", {
        params: { header: { "X-CSRF-Token": csrf } }, body,
        ...(signal ? { signal } : {}),
      }),
    download: (id: string, signal?: AbortSignal) => client.GET("/api/v1/documents/{id}/file", {
      params: { path: { id } }, parseAs: "blob",
      ...(signal ? { signal } : {}),
    }),
    upload: (file: Blob) => client.POST("/api/v1/documents/upload", {
      params: { header: { "X-CSRF-Token": csrf } },
      body: { file },
      bodySerializer(body) {
        const form = new FormData();
        form.set("file", body.file, "synthetic.epub");
        return form;
      },
    }),
  };
}

export async function typedUsage(client: ReturnType<typeof proofClient>) {
  const list = await client.documents();
  if (list.error) return list.error.code;
  if (!list.data) throw new Error("Missing document envelope");
  const title: string | null | undefined = list.data.items[0]?.title;
  const download = await client.download("book-a");
  if (download.error) return download.error.code;
  if (!download.data) throw new Error("Missing EPUB");
  const book: Blob = download.data;
  const uploaded = await client.upload(book);
  if (uploaded.error) return uploaded.error.code;
  return { title, disposition: uploaded.data?.disposition };
}

// Acknowledgement Gate - Generated types are not runtime validation; a durable outbox must verify the exact immutable event before deletion.
export function isProgressAcknowledgement(value: unknown, eventId: string): boolean {
  return typeof value === "object" && value !== null &&
    "event_id" in value && value.event_id === eventId &&
    "kind" in value && value.kind === "progress" &&
    "revision" in value && typeof value.revision === "string" && /^[1-9][0-9]{0,17}$/.test(value.revision);
}
