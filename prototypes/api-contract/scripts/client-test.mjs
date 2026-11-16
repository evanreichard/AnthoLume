import assert from "node:assert/strict";
import { proofClient, isProgressAcknowledgement } from "../client/client.ts";

for (const value of [null, {}, { event_id: "new", kind: "progress", revision: "1" }, { event_id: "e", kind: "activity", revision: "1" }, { event_id: "e", kind: "progress", revision: 1 }, { event_id: "e", kind: "progress", revision: "01" }]) {
  assert.equal(isProgressAcknowledgement(value, "e"), false);
}
assert.equal(isProgressAcknowledgement({ event_id: "e", kind: "progress", revision: "3" }, "e"), true);

let count = 0;
const problem = { type: "urn:antholume:problem:unauthenticated", title: "Request failed", status: 401, code: "unauthenticated", detail: "The request could not be completed." };
const client = proofClient("https://proof.invalid", "fixture-csrf", async (request) => {
  assert.equal(request.credentials, "same-origin");
  count++;
  if (count === 1) return new Response("EPUB bytes", { headers: { "Content-Type": "application/epub+zip" } });
  if (count === 2) return new Response(JSON.stringify(problem), { status: 401, headers: { "Content-Type": "application/problem+json" } });
  assert.equal(request.headers.get("X-CSRF-Token"), "fixture-csrf");
  assert.match(request.headers.get("Content-Type"), /^multipart\/form-data; boundary=/);
  const form = await request.formData();
  const file = form.get("file");
  assert.ok(file instanceof Blob);
  assert.equal(await file.text(), "EPUB bytes");
  return new Response(JSON.stringify({ bytes: 10, disposition: "validated_only" }), { headers: { "Content-Type": "application/json" } });
});
const download = await client.download("book-a");
assert.ok(download.data instanceof Blob);
assert.equal(await download.data.text(), "EPUB bytes");
const denied = await client.download("book-a");
assert.equal(denied.error.code, "unauthenticated");
const upload = await client.upload(download.data);
assert.equal(upload.data.disposition, "validated_only");
console.log("Typed client: Blob download, JSON binary error, multipart serialization, acknowledgement gate passed (mock fetch).");
