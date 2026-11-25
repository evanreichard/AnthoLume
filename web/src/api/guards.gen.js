// Generated from api/openapi.yaml; do not edit.
export const [checkLookupMetadata200, checkListManagedDevices200, checkListAdminUsers200, checkListAdminJobs200, checkListAdminStorageRoots200, checkListAdminAutoImports200, checkPreviewAdminImport200, checkListAdminImportResults200, checkSession, checkSessionUser, checkID, checkCapabilities, checkHardcoverStatus, checkHardcoverConnect, checkHardcoverShelf, checkHardcoverBook, checkDocumentPage, checkDocument, checkBookReadingStats, checkDocumentMatch, checkMetadataProvider, checkMetadataWorkID, checkMetadataMatch, checkMetadataEditionID, checkAdminMetadataProvider, checkManagedDevice, checkDevice, checkReadingState, checkRevision, checkReceipt, checkEventID, checkInsights, checkInsightDay, checkInsightActivityPage, checkInsightActivity, checkInsightCursor, checkInsightProgressPage, checkInsightProgress, checkInsightRankings, checkInsightRank, checkAdminUser, checkAdminJob, checkAdminBackupPreview, checkAdminRestore, checkAdminLogPage, checkAdminLog, checkAdminLogLevel, checkAdminStorageRoot, checkStorageRootID, checkMakeLibraryPlan, checkAdminStorageDirectories, checkAdminAutoImport, checkAutoImportID, checkAdminAutoImportSettings, checkAutoImportScanTrigger, checkAutoImportScanSummary, checkAdminImportResult, checkAdminSystem, checkProblem, checkAdminBackupPathIssue, checkAdminBackupPathKind] = (function() {
'use strict'
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const ref2 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (!(data === "openlibrary" || data === "hardcover")) return false
  return true
};
const stringLength = (string) =>
  /[\uD800-\uDFFF]/.test(string) ? [...string].length : string.length;
const ref3 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (data.length > 64 && stringLength(data) > 64) return false
  if (data.length < 1 || stringLength(data) < 1) return false
  return true
};
const ref4 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (data.length > 64 && stringLength(data) > 64) return false
  if (data.length < 1 || stringLength(data) < 1) return false
  return true
};
const ref1 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("provider" in data && hasOwn(data, "provider"))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("title" in data && hasOwn(data, "title"))) return false
  if (!("author" in data && hasOwn(data, "author"))) return false
  if (!ref2(data.provider)) return false
  if (!ref3(data.id)) return false
  if (!(typeof data.title === "string")) return false
  if (!(typeof data.author === "string")) return false
  if ("year" in data && hasOwn(data, "year")) {
    if (!Number.isInteger(data.year)) return false
    if (!(-9007199254740991 <= data.year)) return false
    if (!(9007199254740991 >= data.year)) return false
  }
  if ("edition_id" in data && hasOwn(data, "edition_id")) {
    if (!ref4(data.edition_id)) return false
  }
  if ("publisher" in data && hasOwn(data, "publisher")) {
    if (!(typeof data.publisher === "string")) return false
  }
  if ("published" in data && hasOwn(data, "published")) {
    if (!(typeof data.published === "string")) return false
  }
  if ("cover_id" in data && hasOwn(data, "cover_id")) {
    if (!Number.isInteger(data.cover_id)) return false
    if (!(1 <= data.cover_id)) return false
    if (!(9999999999 >= data.cover_id)) return false
  }
  if ("description" in data && hasOwn(data, "description")) {
    if (!(typeof data.description === "string")) return false
  }
  if ("isbn10" in data && hasOwn(data, "isbn10")) {
    if (!(typeof data.isbn10 === "string")) return false
  }
  if ("isbn13" in data && hasOwn(data, "isbn13")) {
    if (!(typeof data.isbn13 === "string")) return false
  }
  for (const key0 of Object.keys(data)) {
    if (key0 !== "provider" && key0 !== "id" && key0 !== "title" && key0 !== "author" && key0 !== "year" && key0 !== "edition_id" && key0 !== "publisher" && key0 !== "published" && key0 !== "cover_id" && key0 !== "description" && key0 !== "isbn10" && key0 !== "isbn13") return false
  }
  return true
};
const ref0 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 8) return false
  for (let i = 0; i < data.length; i++) {
    if (i in data && hasOwn(data, i)) {
      if (!ref1(data[i])) return false
    }
  }
  return true
};
const ref7 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (data.length > 128 && stringLength(data) > 128) return false
  if (data.length < 1 || stringLength(data) < 1) return false
  return true
};
const format0 = value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const ref6 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("name" in data && hasOwn(data, "name"))) return false
  if (!("label" in data && hasOwn(data, "label"))) return false
  if (!("archived" in data && hasOwn(data, "archived"))) return false
  if (!("last_synced" in data && hasOwn(data, "last_synced"))) return false
  if (!ref7(data.id)) return false
  if (!(typeof data.name === "string")) return false
  if (!(typeof data.label === "string")) return false
  if (!(typeof data.archived === "boolean")) return false
  if (!(typeof data.last_synced === "string")) return false
  if (!format0(data.last_synced)) return false
  for (const key1 of Object.keys(data)) {
    if (key1 !== "id" && key1 !== "name" && key1 !== "label" && key1 !== "archived" && key1 !== "last_synced") return false
  }
  return true
};
const ref5 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 500) return false
  for (let j = 0; j < data.length; j++) {
    if (j in data && hasOwn(data, j)) {
      if (!ref6(data[j])) return false
    }
  }
  return true
};
const ref9 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("is_admin" in data && hasOwn(data, "is_admin"))) return false
  if (!ref7(data.id)) return false
  if (!(typeof data.is_admin === "boolean")) return false
  for (const key2 of Object.keys(data)) {
    if (key2 !== "id" && key2 !== "is_admin") return false
  }
  return true
};
const ref8 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 51) return false
  for (let k = 0; k < data.length; k++) {
    if (k in data && hasOwn(data, k)) {
      if (!ref9(data[k])) return false
    }
  }
  return true
};
const ref11 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("kind" in data && hasOwn(data, "kind"))) return false
  if (!("status" in data && hasOwn(data, "status"))) return false
  if (!("started_at" in data && hasOwn(data, "started_at"))) return false
  if (!("finished_at" in data && hasOwn(data, "finished_at"))) return false
  if (!ref7(data.id)) return false
  if (!(typeof data.kind === "string")) return false
  if (!(data.kind === "statistics" || data.kind === "database_check" || data.kind === "import")) return false
  if (!(typeof data.status === "string")) return false
  if (!(data.status === "running" || data.status === "succeeded" || data.status === "failed" || data.status === "interrupted")) return false
  if (!(typeof data.started_at === "string")) return false
  if (!format0(data.started_at)) return false
  if (!(typeof data.finished_at === "string" || data.finished_at === null)) return false
  if (typeof data.finished_at === "string") {
    if (!format0(data.finished_at)) return false
  }
  for (const key3 of Object.keys(data)) {
    if (key3 !== "id" && key3 !== "kind" && key3 !== "status" && key3 !== "started_at" && key3 !== "finished_at") return false
  }
  return true
};
const ref10 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 20) return false
  for (let l = 0; l < data.length; l++) {
    if (l in data && hasOwn(data, l)) {
      if (!ref11(data[l])) return false
    }
  }
  return true
};
const pattern0 = new RegExp("^[a-z0-9][a-z0-9-]*$", "u");
const ref14 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (data.length > 64 && stringLength(data) > 64) return false
  if (data.length < 1 || stringLength(data) < 1) return false
  if (!pattern0.test(data)) return false
  return true
};
const ref13 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("label" in data && hasOwn(data, "label"))) return false
  if (!("path" in data && hasOwn(data, "path"))) return false
  if (!("managed" in data && hasOwn(data, "managed"))) return false
  if (!("directory_available" in data && hasOwn(data, "directory_available"))) return false
  if (!("book_count" in data && hasOwn(data, "book_count"))) return false
  if (!ref14(data.id)) return false
  if (!(typeof data.label === "string")) return false
  if (data.label.length > 128 && stringLength(data.label) > 128) return false
  if (data.label.length < 1 || stringLength(data.label) < 1) return false
  if (!(typeof data.path === "string")) return false
  if (data.path.length > 4096 && stringLength(data.path) > 4096) return false
  if (!(typeof data.managed === "boolean")) return false
  if (!(typeof data.directory_available === "boolean")) return false
  if ("legacy_path" in data && hasOwn(data, "legacy_path")) {
    if (!(typeof data.legacy_path === "string")) return false
  }
  if (!Number.isInteger(data.book_count)) return false
  if (!(0 <= data.book_count)) return false
  if (!(9007199254740991 >= data.book_count)) return false
  for (const key4 of Object.keys(data)) {
    if (key4 !== "id" && key4 !== "label" && key4 !== "path" && key4 !== "managed" && key4 !== "directory_available" && key4 !== "legacy_path" && key4 !== "book_count") return false
  }
  return true
};
const ref12 = function validate(data) {
  if (!Array.isArray(data)) return false
  for (let m = 0; m < data.length; m++) {
    if (m in data && hasOwn(data, m)) {
      if (!ref13(data[m])) return false
    }
  }
  return true
};
const pattern1 = new RegExp("^[a-f0-9]{32}$", "u");
const ref17 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (!pattern1.test(data)) return false
  return true
};
const ref18 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("name" in data && hasOwn(data, "name"))) return false
  if (!("root_id" in data && hasOwn(data, "root_id"))) return false
  if (!("enabled" in data && hasOwn(data, "enabled"))) return false
  if (!("watch" in data && hasOwn(data, "watch"))) return false
  if (!("interval_minutes" in data && hasOwn(data, "interval_minutes"))) return false
  if (!("reference" in data && hasOwn(data, "reference"))) return false
  if (!(typeof data.name === "string")) return false
  if (data.name.length > 120 && stringLength(data.name) > 120) return false
  if (data.name.length < 1 || stringLength(data.name) < 1) return false
  if (!ref14(data.root_id)) return false
  if (!(typeof data.enabled === "boolean")) return false
  if (!(typeof data.watch === "boolean")) return false
  if (!Number.isInteger(data.interval_minutes)) return false
  if (!(1 <= data.interval_minutes)) return false
  if (!(1440 >= data.interval_minutes)) return false
  if (!(typeof data.reference === "boolean")) return false
  for (const key5 of Object.keys(data)) {
    if (key5 !== "name" && key5 !== "root_id" && key5 !== "enabled" && key5 !== "watch" && key5 !== "interval_minutes" && key5 !== "reference") return false
  }
  return true
};
const ref19 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (!(data === "on_change" || data === "scheduled" || data === "manual" || data === "initial")) return false
  return true
};
const ref20 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("books_added" in data && hasOwn(data, "books_added"))) return false
  if (!("source_total" in data && hasOwn(data, "source_total"))) return false
  if (!Number.isInteger(data.books_added)) return false
  if (!(0 <= data.books_added)) return false
  if (!(9007199254740991 >= data.books_added)) return false
  if (!Number.isInteger(data.source_total)) return false
  if (!(0 <= data.source_total)) return false
  if (!(9007199254740991 >= data.source_total)) return false
  for (const key6 of Object.keys(data)) {
    if (key6 !== "books_added" && key6 !== "source_total") return false
  }
  return true
};
const ref16 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("settings" in data && hasOwn(data, "settings"))) return false
  if (!("status" in data && hasOwn(data, "status"))) return false
  if (!ref17(data.id)) return false
  if (!ref18(data.settings)) return false
  if (!(typeof data.status === "string")) return false
  if (!(data.status === "idle" || data.status === "complete" || data.status === "errors" || data.status === "unavailable")) return false
  if ("last_scan" in data && hasOwn(data, "last_scan")) {
    if (!(typeof data.last_scan === "string")) return false
    if (!format0(data.last_scan)) return false
  }
  if ("last_scan_trigger" in data && hasOwn(data, "last_scan_trigger")) {
    if (!ref19(data.last_scan_trigger)) return false
  }
  if ("next_scan" in data && hasOwn(data, "next_scan")) {
    if (!(typeof data.next_scan === "string")) return false
    if (!format0(data.next_scan)) return false
  }
  if ("scan_summary" in data && hasOwn(data, "scan_summary")) {
    if (!ref20(data.scan_summary)) return false
  }
  for (const key7 of Object.keys(data)) {
    if (key7 !== "id" && key7 !== "settings" && key7 !== "status" && key7 !== "last_scan" && key7 !== "last_scan_trigger" && key7 !== "next_scan" && key7 !== "scan_summary") return false
  }
  return true
};
const ref15 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 100) return false
  for (let n = 0; n < data.length; n++) {
    if (n in data && hasOwn(data, n)) {
      if (!ref16(data[n])) return false
    }
  }
  return true
};
const ref21 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 1000) return false
  for (let o = 0; o < data.length; o++) {
    if (o in data && hasOwn(data, o)) {
      if (!(typeof data[o] === "string")) return false
    }
  }
  return true
};
const ref23 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("file" in data && hasOwn(data, "file"))) return false
  if (!("status" in data && hasOwn(data, "status"))) return false
  if (!(typeof data.file === "string")) return false
  if (!(typeof data.status === "string")) return false
  if (!(data.status === "imported" || data.status === "relinked" || data.status === "skipped" || data.status === "failed")) return false
  for (const key8 of Object.keys(data)) {
    if (key8 !== "file" && key8 !== "status") return false
  }
  return true
};
const ref22 = function validate(data) {
  if (!Array.isArray(data)) return false
  if (data.length > 1000) return false
  for (let p = 0; p < data.length; p++) {
    if (p in data && hasOwn(data, p)) {
      if (!ref23(data[p])) return false
    }
  }
  return true
};
const pattern2 = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "u");
const pattern3 = new RegExp("^[0-9a-f]{32}$", "u");
const ref26 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data) || data === null)) return false
  if (typeof data === "object" && data && !Array.isArray(data)) {
    if (!("id" in data && hasOwn(data, "id"))) return false
    if (!("account_id" in data && hasOwn(data, "account_id"))) return false
    if (!("reading_generation" in data && hasOwn(data, "reading_generation"))) return false
    if (!("is_admin" in data && hasOwn(data, "is_admin"))) return false
    if (!("timezone" in data && hasOwn(data, "timezone"))) return false
    if (!ref7(data.id)) return false
    if (!(typeof data.account_id === "string")) return false
    if (!pattern2.test(data.account_id)) return false
    if (!(typeof data.reading_generation === "string")) return false
    if (!pattern3.test(data.reading_generation)) return false
    if (!(typeof data.is_admin === "boolean")) return false
    if (!(typeof data.timezone === "string")) return false
    for (const key9 of Object.keys(data)) {
      if (key9 !== "id" && key9 !== "account_id" && key9 !== "reading_generation" && key9 !== "is_admin" && key9 !== "timezone") return false
    }
  }
  return true
};
const ref25 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("user" in data && hasOwn(data, "user"))) return false
  if (!("csrf_token" in data && hasOwn(data, "csrf_token"))) return false
  if (!("expires_at" in data && hasOwn(data, "expires_at"))) return false
  if (!ref26(data.user)) return false
  if (!(typeof data.csrf_token === "string")) return false
  if (data.csrf_token.length > 128 && stringLength(data.csrf_token) > 128) return false
  if (data.csrf_token.length < 32 || stringLength(data.csrf_token) < 32) return false
  if (!(typeof data.expires_at === "string" || data.expires_at === null)) return false
  if (typeof data.expires_at === "string") {
    if (!format0(data.expires_at)) return false
  }
  for (const key10 of Object.keys(data)) {
    if (key10 !== "user" && key10 !== "csrf_token" && key10 !== "expires_at") return false
  }
  return true
};
const ref24 = function validate(data) {
  if (!ref25(data)) return false
  return true
};
const ref27 = function validate(data) {
  if (!ref26(data)) return false
  return true
};
const ref28 = function validate(data) {
  if (!ref7(data)) return false
  return true
};
const ref30 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("registration_enabled" in data && hasOwn(data, "registration_enabled"))) return false
  if (!("search_enabled" in data && hasOwn(data, "search_enabled"))) return false
  if (!(typeof data.registration_enabled === "boolean")) return false
  if (!(typeof data.search_enabled === "boolean")) return false
  for (const key11 of Object.keys(data)) {
    if (key11 !== "registration_enabled" && key11 !== "search_enabled") return false
  }
  return true
};
const ref29 = function validate(data) {
  if (!ref30(data)) return false
  return true
};
const ref32 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("enabled" in data && hasOwn(data, "enabled"))) return false
  if (!("username" in data && hasOwn(data, "username"))) return false
  if (!("reconnect_required" in data && hasOwn(data, "reconnect_required"))) return false
  if (!(typeof data.enabled === "boolean")) return false
  if (!(typeof data.username === "string" || data.username === null)) return false
  if (!(typeof data.reconnect_required === "boolean")) return false
  for (const key12 of Object.keys(data)) {
    if (key12 !== "enabled" && key12 !== "username" && key12 !== "reconnect_required") return false
  }
  return true
};
const ref31 = function validate(data) {
  if (!ref32(data)) return false
  return true
};
const format1 = new RegExp("^[a-z][a-z0-9+\\-.]*:(?:\\/?\\/(?:(?:[a-z0-9\\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d\\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|v[0-9a-f]+\\.[a-z0-9\\-._~!$&'()*+,;=:]+)\\]|(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d\\d?)|(?:[a-z0-9\\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\\d*)?(?:\\/(?:[a-z0-9\\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\\/?(?:(?:[a-z0-9\\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\\/(?:[a-z0-9\\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?)(?:\\?(?:[a-z0-9\\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$", "i");
const ref34 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("authorization_url" in data && hasOwn(data, "authorization_url"))) return false
  if (!(typeof data.authorization_url === "string")) return false
  if (!format1.test(data.authorization_url)) return false
  for (const key13 of Object.keys(data)) {
    if (key13 !== "authorization_url") return false
  }
  return true
};
const ref33 = function validate(data) {
  if (!ref34(data)) return false
  return true
};
const ref37 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("title" in data && hasOwn(data, "title"))) return false
  if (!("author" in data && hasOwn(data, "author"))) return false
  if (!(typeof data.id === "string")) return false
  if (!(typeof data.title === "string")) return false
  if (!(typeof data.author === "string")) return false
  for (const key14 of Object.keys(data)) {
    if (key14 !== "id" && key14 !== "title" && key14 !== "author") return false
  }
  return true
};
const ref36 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("books" in data && hasOwn(data, "books"))) return false
  if (!("next_offset" in data && hasOwn(data, "next_offset"))) return false
  if (!Array.isArray(data.books)) return false
  for (let q = 0; q < data.books.length; q++) {
    if (q in data.books && hasOwn(data.books, q)) {
      if (!ref37(data.books[q])) return false
    }
  }
  if (!(Number.isInteger(data.next_offset) || data.next_offset === null)) return false
  if (typeof data.next_offset === "number") {
    if (!(0 <= data.next_offset)) return false
    if (!(2147483647 >= data.next_offset)) return false
  }
  for (const key15 of Object.keys(data)) {
    if (key15 !== "books" && key15 !== "next_offset") return false
  }
  return true
};
const ref35 = function validate(data) {
  if (!ref36(data)) return false
  return true
};
const ref38 = function validate(data) {
  if (!ref37(data)) return false
  return true
};
const ref42 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("reading_seconds" in data && hasOwn(data, "reading_seconds"))) return false
  if (!("words_per_minute" in data && hasOwn(data, "words_per_minute"))) return false
  if (!("word_count" in data && hasOwn(data, "word_count"))) return false
  if (!Number.isInteger(data.reading_seconds)) return false
  if (!(0 <= data.reading_seconds)) return false
  if (!(9007199254740991 >= data.reading_seconds)) return false
  if (!Number.isInteger(data.words_per_minute)) return false
  if (!(0 <= data.words_per_minute)) return false
  if (!(9007199254740991 >= data.words_per_minute)) return false
  if (!(Number.isInteger(data.word_count) || data.word_count === null)) return false
  if (typeof data.word_count === "number") {
    if (!(0 <= data.word_count)) return false
    if (!(9007199254740991 >= data.word_count)) return false
  }
  for (const key16 of Object.keys(data)) {
    if (key16 !== "reading_seconds" && key16 !== "words_per_minute" && key16 !== "word_count") return false
  }
  return true
};
const ref43 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("provider" in data && hasOwn(data, "provider"))) return false
  if (!("work_id" in data && hasOwn(data, "work_id"))) return false
  if (!ref2(data.provider)) return false
  if (!ref3(data.work_id)) return false
  for (const key17 of Object.keys(data)) {
    if (key17 !== "provider" && key17 !== "work_id") return false
  }
  return true
};
const ref41 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("title" in data && hasOwn(data, "title"))) return false
  if (!("author" in data && hasOwn(data, "author"))) return false
  if (!("series" in data && hasOwn(data, "series"))) return false
  if (!("description" in data && hasOwn(data, "description"))) return false
  if (!("lang" in data && hasOwn(data, "lang"))) return false
  if (!("file_available" in data && hasOwn(data, "file_available"))) return false
  if (!("cover_available" in data && hasOwn(data, "cover_available"))) return false
  if (!("media_type" in data && hasOwn(data, "media_type"))) return false
  if (!("file_size_bytes" in data && hasOwn(data, "file_size_bytes"))) return false
  if (!ref7(data.id)) return false
  if (!(typeof data.title === "string" || data.title === null)) return false
  if (!(typeof data.author === "string" || data.author === null)) return false
  if (!(typeof data.series === "string" || data.series === null)) return false
  if (!(typeof data.description === "string" || data.description === null)) return false
  if (!(typeof data.lang === "string" || data.lang === null)) return false
  if (!(typeof data.file_available === "boolean")) return false
  if (!(typeof data.cover_available === "boolean")) return false
  if (!(typeof data.media_type === "string" || data.media_type === null)) return false
  if (!(Number.isInteger(data.file_size_bytes) || data.file_size_bytes === null)) return false
  if (typeof data.file_size_bytes === "number") {
    if (!(0 <= data.file_size_bytes)) return false
    if (!(9007199254740991 >= data.file_size_bytes)) return false
  }
  if ("storage_root_id" in data && hasOwn(data, "storage_root_id")) {
    if (!(typeof data.storage_root_id === "string")) return false
  }
  if ("relative_file_path" in data && hasOwn(data, "relative_file_path")) {
    if (!(typeof data.relative_file_path === "string")) return false
  }
  if ("reading_stats" in data && hasOwn(data, "reading_stats")) {
    if (!ref42(data.reading_stats)) return false
  }
  if ("matches" in data && hasOwn(data, "matches")) {
    if (!Array.isArray(data.matches)) return false
    for (let s = 0; s < data.matches.length; s++) {
      if (s in data.matches && hasOwn(data.matches, s)) {
        if (!ref43(data.matches[s])) return false
      }
    }
  }
  if ("added_at" in data && hasOwn(data, "added_at")) {
    if (!(typeof data.added_at === "string")) return false
    if (!format0(data.added_at)) return false
  }
  if ("last_read_at" in data && hasOwn(data, "last_read_at")) {
    if (!(typeof data.last_read_at === "string")) return false
    if (!format0(data.last_read_at)) return false
  }
  if ("resume_fraction" in data && hasOwn(data, "resume_fraction")) {
    if (!(typeof data.resume_fraction === "number")) return false
    if (!(0 <= data.resume_fraction)) return false
    if (!(1 >= data.resume_fraction)) return false
  }
  if ("isbn10" in data && hasOwn(data, "isbn10")) {
    if (!(typeof data.isbn10 === "string")) return false
  }
  if ("isbn13" in data && hasOwn(data, "isbn13")) {
    if (!(typeof data.isbn13 === "string")) return false
  }
  for (const key18 of Object.keys(data)) {
    if (key18 !== "id" && key18 !== "title" && key18 !== "author" && key18 !== "series" && key18 !== "description" && key18 !== "lang" && key18 !== "file_available" && key18 !== "cover_available" && key18 !== "media_type" && key18 !== "file_size_bytes" && key18 !== "storage_root_id" && key18 !== "relative_file_path" && key18 !== "reading_stats" && key18 !== "matches" && key18 !== "added_at" && key18 !== "last_read_at" && key18 !== "resume_fraction" && key18 !== "isbn10" && key18 !== "isbn13") return false
  }
  return true
};
const ref40 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("items" in data && hasOwn(data, "items"))) return false
  if (!("total" in data && hasOwn(data, "total"))) return false
  if (!("page" in data && hasOwn(data, "page"))) return false
  if (!("page_size" in data && hasOwn(data, "page_size"))) return false
  if (!("next_page" in data && hasOwn(data, "next_page"))) return false
  if (!Array.isArray(data.items)) return false
  for (let r = 0; r < data.items.length; r++) {
    if (r in data.items && hasOwn(data.items, r)) {
      if (!ref41(data.items[r])) return false
    }
  }
  if (!Number.isInteger(data.total)) return false
  if (!(0 <= data.total)) return false
  if (!(9007199254740991 >= data.total)) return false
  if (!Number.isInteger(data.page)) return false
  if (!(1 <= data.page)) return false
  if (!(9007199254740991 >= data.page)) return false
  if (!Number.isInteger(data.page_size)) return false
  if (!(1 <= data.page_size)) return false
  if (!(100 >= data.page_size)) return false
  if (!(Number.isInteger(data.next_page) || data.next_page === null)) return false
  if (typeof data.next_page === "number") {
    if (!(1 <= data.next_page)) return false
    if (!(9007199254740991 >= data.next_page)) return false
  }
  for (const key19 of Object.keys(data)) {
    if (key19 !== "items" && key19 !== "total" && key19 !== "page" && key19 !== "page_size" && key19 !== "next_page") return false
  }
  return true
};
const ref39 = function validate(data) {
  if (!ref40(data)) return false
  return true
};
const ref44 = function validate(data) {
  if (!ref41(data)) return false
  return true
};
const ref45 = function validate(data) {
  if (!ref42(data)) return false
  return true
};
const ref46 = function validate(data) {
  if (!ref43(data)) return false
  return true
};
const ref47 = function validate(data) {
  if (!ref2(data)) return false
  return true
};
const ref48 = function validate(data) {
  if (!ref3(data)) return false
  return true
};
const ref49 = function validate(data) {
  if (!ref1(data)) return false
  return true
};
const ref50 = function validate(data) {
  if (!ref4(data)) return false
  return true
};
const ref52 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("selected" in data && hasOwn(data, "selected"))) return false
  if (!("effective" in data && hasOwn(data, "effective"))) return false
  if (!("hardcover_available" in data && hasOwn(data, "hardcover_available"))) return false
  if (!ref2(data.selected)) return false
  if (!ref2(data.effective)) return false
  if (!(typeof data.hardcover_available === "boolean")) return false
  for (const key20 of Object.keys(data)) {
    if (key20 !== "selected" && key20 !== "effective" && key20 !== "hardcover_available") return false
  }
  return true
};
const ref51 = function validate(data) {
  if (!ref52(data)) return false
  return true
};
const ref53 = function validate(data) {
  if (!ref6(data)) return false
  return true
};
const ref55 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("name" in data && hasOwn(data, "name"))) return false
  if (!ref7(data.id)) return false
  if (!(typeof data.name === "string")) return false
  if (data.name.length > 128 && stringLength(data.name) > 128) return false
  if (data.name.length < 1 || stringLength(data.name) < 1) return false
  for (const key21 of Object.keys(data)) {
    if (key21 !== "id" && key21 !== "name") return false
  }
  return true
};
const ref54 = function validate(data) {
  if (!ref55(data)) return false
  return true
};
const pattern4 = new RegExp("^(0|[1-9][0-9]{0,17})$", "u");
const ref58 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (!pattern4.test(data)) return false
  return true
};
const ref57 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("document_id" in data && hasOwn(data, "document_id"))) return false
  if (!("revision" in data && hasOwn(data, "revision"))) return false
  if (!("position" in data && hasOwn(data, "position"))) return false
  if (!("fraction" in data && hasOwn(data, "fraction"))) return false
  if (!("device_id" in data && hasOwn(data, "device_id"))) return false
  if (!("updated_at" in data && hasOwn(data, "updated_at"))) return false
  if (!ref7(data.document_id)) return false
  if (!ref58(data.revision)) return false
  if (!(typeof data.position === "string" || data.position === null)) return false
  if (typeof data.position === "string") {
    if (data.position.length > 4096 && stringLength(data.position) > 4096) return false
  }
  if (!(typeof data.fraction === "number" || data.fraction === null)) return false
  if (typeof data.fraction === "number") {
    if (!(0 <= data.fraction)) return false
    if (!(1 >= data.fraction)) return false
  }
  if (!(typeof data.device_id === "string" || data.device_id === null)) return false
  if (typeof data.device_id === "string") {
    if (data.device_id.length > 128 && stringLength(data.device_id) > 128) return false
    if (data.device_id.length < 1 || stringLength(data.device_id) < 1) return false
  }
  if (!(typeof data.updated_at === "string" || data.updated_at === null)) return false
  if (typeof data.updated_at === "string") {
    if (!format0(data.updated_at)) return false
  }
  for (const key22 of Object.keys(data)) {
    if (key22 !== "document_id" && key22 !== "revision" && key22 !== "position" && key22 !== "fraction" && key22 !== "device_id" && key22 !== "updated_at") return false
  }
  return true
};
const ref56 = function validate(data) {
  if (!ref57(data)) return false
  return true
};
const ref59 = function validate(data) {
  if (!ref58(data)) return false
  return true
};
const format2 = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "i");
const pattern5 = new RegExp("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", "u");
const ref62 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (data.length > 36 && stringLength(data) > 36) return false
  if (data.length < 36 || stringLength(data) < 36) return false
  if (!format2.test(data)) return false
  if (!pattern5.test(data)) return false
  return true
};
const ref61 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("event_id" in data && hasOwn(data, "event_id"))) return false
  if (!("kind" in data && hasOwn(data, "kind"))) return false
  if (!("revision" in data && hasOwn(data, "revision"))) return false
  if (!ref62(data.event_id)) return false
  if (!(typeof data.kind === "string")) return false
  if (!(data.kind === "progress" || data.kind === "activity")) return false
  if (!(typeof data.revision === "string" || data.revision === null)) return false
  if (typeof data.revision === "string") {
    if (!pattern4.test(data.revision)) return false
  }
  for (const key23 of Object.keys(data)) {
    if (key23 !== "event_id" && key23 !== "kind" && key23 !== "revision") return false
  }
  return true
};
const ref60 = function validate(data) {
  if (!ref61(data)) return false
  return true
};
const ref63 = function validate(data) {
  if (!ref62(data)) return false
  return true
};
const format3 = (input) => {
    if (input.length !== 10) return false
    if (input[5] === '0' && input[6] === '2') {
      if (/^\d\d\d\d-02-(?:[012][1-8]|[12]0|[01]9)$/.test(input)) return true
      const matches = input.match(/^(\d\d\d\d)-02-29$/)
      if (!matches) return false
      const year = matches[1] | 0
      return year % 16 === 0 || (year % 4 === 0 && year % 25 !== 0)
    }
    if (input.endsWith('31')) return /^\d\d\d\d-(?:0[13578]|1[02])-31$/.test(input)
    return /^\d\d\d\d-(?:0[13-9]|1[012])-(?:[012][1-9]|[123]0)$/.test(input)
  };
const ref66 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("date" in data && hasOwn(data, "date"))) return false
  if (!("seconds_read" in data && hasOwn(data, "seconds_read"))) return false
  if (!(typeof data.date === "string")) return false
  if (!format3(data.date)) return false
  if (!Number.isInteger(data.seconds_read)) return false
  if (!(0 <= data.seconds_read)) return false
  if (!(9007199254740991 >= data.seconds_read)) return false
  for (const key24 of Object.keys(data)) {
    if (key24 !== "date" && key24 !== "seconds_read") return false
  }
  return true
};
const ref65 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("timezone" in data && hasOwn(data, "timezone"))) return false
  if (!("as_of" in data && hasOwn(data, "as_of"))) return false
  if (!("days" in data && hasOwn(data, "days"))) return false
  if (!("seconds_read" in data && hasOwn(data, "seconds_read"))) return false
  if (!("active_days" in data && hasOwn(data, "active_days"))) return false
  if (!("current_streak" in data && hasOwn(data, "current_streak"))) return false
  if (!("longest_streak" in data && hasOwn(data, "longest_streak"))) return false
  if (!("current_week_streak" in data && hasOwn(data, "current_week_streak"))) return false
  if (!("longest_week_streak" in data && hasOwn(data, "longest_week_streak"))) return false
  if (!(typeof data.timezone === "string")) return false
  if (data.timezone.length > 128 && stringLength(data.timezone) > 128) return false
  if (data.timezone.length < 1 || stringLength(data.timezone) < 1) return false
  if (!(typeof data.as_of === "string")) return false
  if (!format0(data.as_of)) return false
  if (!Array.isArray(data.days)) return false
  if (data.days.length > 30) return false
  if (data.days.length < 30) return false
  for (let t = 0; t < data.days.length; t++) {
    if (t in data.days && hasOwn(data.days, t)) {
      if (!ref66(data.days[t])) return false
    }
  }
  if (!Number.isInteger(data.seconds_read)) return false
  if (!(0 <= data.seconds_read)) return false
  if (!(9007199254740991 >= data.seconds_read)) return false
  if (!Number.isInteger(data.active_days)) return false
  if (!(0 <= data.active_days)) return false
  if (!(9007199254740991 >= data.active_days)) return false
  if (!Number.isInteger(data.current_streak)) return false
  if (!(0 <= data.current_streak)) return false
  if (!(9007199254740991 >= data.current_streak)) return false
  if (!Number.isInteger(data.longest_streak)) return false
  if (!(0 <= data.longest_streak)) return false
  if (!(9007199254740991 >= data.longest_streak)) return false
  if (!Number.isInteger(data.current_week_streak)) return false
  if (!(0 <= data.current_week_streak)) return false
  if (!(9007199254740991 >= data.current_week_streak)) return false
  if (!Number.isInteger(data.longest_week_streak)) return false
  if (!(0 <= data.longest_week_streak)) return false
  if (!(9007199254740991 >= data.longest_week_streak)) return false
  for (const key25 of Object.keys(data)) {
    if (key25 !== "timezone" && key25 !== "as_of" && key25 !== "days" && key25 !== "seconds_read" && key25 !== "active_days" && key25 !== "current_streak" && key25 !== "longest_streak" && key25 !== "current_week_streak" && key25 !== "longest_week_streak") return false
  }
  return true
};
const ref64 = function validate(data) {
  if (!ref65(data)) return false
  return true
};
const ref67 = function validate(data) {
  if (!ref66(data)) return false
  return true
};
const ref70 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("document_id" in data && hasOwn(data, "document_id"))) return false
  if (!("title" in data && hasOwn(data, "title"))) return false
  if (!("available" in data && hasOwn(data, "available"))) return false
  if (!("started_at" in data && hasOwn(data, "started_at"))) return false
  if (!("duration" in data && hasOwn(data, "duration"))) return false
  if (!("start_fraction" in data && hasOwn(data, "start_fraction"))) return false
  if (!("end_fraction" in data && hasOwn(data, "end_fraction"))) return false
  if (!ref7(data.id)) return false
  if (!ref7(data.document_id)) return false
  if (!(typeof data.title === "string")) return false
  if (!(typeof data.available === "boolean")) return false
  if (!(typeof data.started_at === "string")) return false
  if (!format0(data.started_at)) return false
  if (!Number.isInteger(data.duration)) return false
  if (!(0 <= data.duration)) return false
  if (!(9007199254740991 >= data.duration)) return false
  if (!(typeof data.start_fraction === "number")) return false
  if (!(0 <= data.start_fraction)) return false
  if (!(1 >= data.start_fraction)) return false
  if (!(typeof data.end_fraction === "number")) return false
  if (!(0 <= data.end_fraction)) return false
  if (!(1 >= data.end_fraction)) return false
  for (const key26 of Object.keys(data)) {
    if (key26 !== "id" && key26 !== "document_id" && key26 !== "title" && key26 !== "available" && key26 !== "started_at" && key26 !== "duration" && key26 !== "start_fraction" && key26 !== "end_fraction") return false
  }
  return true
};
const pattern6 = new RegExp("^[A-Za-z0-9_-]+$", "u");
const ref71 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (data.length > 1024 && stringLength(data) > 1024) return false
  if (!pattern6.test(data)) return false
  return true
};
const ref69 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("items" in data && hasOwn(data, "items"))) return false
  if (!("has_more" in data && hasOwn(data, "has_more"))) return false
  if (!("timezone" in data && hasOwn(data, "timezone"))) return false
  if (!Array.isArray(data.items)) return false
  if (data.items.length > 20) return false
  for (let u = 0; u < data.items.length; u++) {
    if (u in data.items && hasOwn(data.items, u)) {
      if (!ref70(data.items[u])) return false
    }
  }
  if (!(typeof data.has_more === "boolean")) return false
  if ("next_cursor" in data && hasOwn(data, "next_cursor")) {
    if (!ref71(data.next_cursor)) return false
  }
  if (!(typeof data.timezone === "string")) return false
  if (data.timezone.length > 128 && stringLength(data.timezone) > 128) return false
  if (data.timezone.length < 1 || stringLength(data.timezone) < 1) return false
  for (const key27 of Object.keys(data)) {
    if (key27 !== "items" && key27 !== "has_more" && key27 !== "next_cursor" && key27 !== "timezone") return false
  }
  return true
};
const ref68 = function validate(data) {
  if (!ref69(data)) return false
  return true
};
const ref72 = function validate(data) {
  if (!ref70(data)) return false
  return true
};
const ref73 = function validate(data) {
  if (!ref71(data)) return false
  return true
};
const ref76 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("document_id" in data && hasOwn(data, "document_id"))) return false
  if (!("title" in data && hasOwn(data, "title"))) return false
  if (!("available" in data && hasOwn(data, "available"))) return false
  if (!("updated_at" in data && hasOwn(data, "updated_at"))) return false
  if (!("fraction" in data && hasOwn(data, "fraction"))) return false
  if (!ref7(data.document_id)) return false
  if (!(typeof data.title === "string")) return false
  if (!(typeof data.available === "boolean")) return false
  if (!(typeof data.updated_at === "string")) return false
  if (!format0(data.updated_at)) return false
  if (!(typeof data.fraction === "number" || data.fraction === null)) return false
  if (typeof data.fraction === "number") {
    if (!(0 <= data.fraction)) return false
    if (!(1 >= data.fraction)) return false
  }
  for (const key28 of Object.keys(data)) {
    if (key28 !== "document_id" && key28 !== "title" && key28 !== "available" && key28 !== "updated_at" && key28 !== "fraction") return false
  }
  return true
};
const ref75 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("items" in data && hasOwn(data, "items"))) return false
  if (!("has_more" in data && hasOwn(data, "has_more"))) return false
  if (!("timezone" in data && hasOwn(data, "timezone"))) return false
  if (!Array.isArray(data.items)) return false
  if (data.items.length > 20) return false
  for (let v = 0; v < data.items.length; v++) {
    if (v in data.items && hasOwn(data.items, v)) {
      if (!ref76(data.items[v])) return false
    }
  }
  if (!(typeof data.has_more === "boolean")) return false
  if ("next_cursor" in data && hasOwn(data, "next_cursor")) {
    if (!ref71(data.next_cursor)) return false
  }
  if (!(typeof data.timezone === "string")) return false
  if (data.timezone.length > 128 && stringLength(data.timezone) > 128) return false
  if (data.timezone.length < 1 || stringLength(data.timezone) < 1) return false
  for (const key29 of Object.keys(data)) {
    if (key29 !== "items" && key29 !== "has_more" && key29 !== "next_cursor" && key29 !== "timezone") return false
  }
  return true
};
const ref74 = function validate(data) {
  if (!ref75(data)) return false
  return true
};
const ref77 = function validate(data) {
  if (!ref76(data)) return false
  return true
};
const ref80 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("user" in data && hasOwn(data, "user"))) return false
  if (!("value" in data && hasOwn(data, "value"))) return false
  if (!ref7(data.user)) return false
  if (!Number.isInteger(data.value)) return false
  if (!(0 <= data.value)) return false
  if (!(9007199254740991 >= data.value)) return false
  for (const key30 of Object.keys(data)) {
    if (key30 !== "user" && key30 !== "value") return false
  }
  return true
};
const ref79 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("items" in data && hasOwn(data, "items"))) return false
  if (!("as_of" in data && hasOwn(data, "as_of"))) return false
  if (!(typeof data.as_of === "string")) return false
  if (!format0(data.as_of)) return false
  if (!Array.isArray(data.items)) return false
  if (data.items.length > 20) return false
  for (let x = 0; x < data.items.length; x++) {
    if (x in data.items && hasOwn(data.items, x)) {
      if (!ref80(data.items[x])) return false
    }
  }
  for (const key31 of Object.keys(data)) {
    if (key31 !== "as_of" && key31 !== "items") return false
  }
  return true
};
const ref78 = function validate(data) {
  if (!ref79(data)) return false
  return true
};
const ref81 = function validate(data) {
  if (!ref80(data)) return false
  return true
};
const ref82 = function validate(data) {
  if (!ref9(data)) return false
  return true
};
const ref83 = function validate(data) {
  if (!ref11(data)) return false
  return true
};
const ref85 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("files" in data && hasOwn(data, "files"))) return false
  if (!("bytes" in data && hasOwn(data, "bytes"))) return false
  if (!("missing" in data && hasOwn(data, "missing"))) return false
  if (!Number.isInteger(data.files)) return false
  if (!(0 <= data.files)) return false
  if (!(9007199254740991 >= data.files)) return false
  if (!Number.isInteger(data.bytes)) return false
  if (!(0 <= data.bytes)) return false
  if (!(9007199254740991 >= data.bytes)) return false
  if (!Number.isInteger(data.missing)) return false
  if (!(0 <= data.missing)) return false
  if (!(9007199254740991 >= data.missing)) return false
  for (const key32 of Object.keys(data)) {
    if (key32 !== "files" && key32 !== "bytes" && key32 !== "missing") return false
  }
  return true
};
const ref84 = function validate(data) {
  if (!ref85(data)) return false
  return true
};
const pattern7 = new RegExp("^[a-f0-9]{64}$", "u");
const ref87 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("token" in data && hasOwn(data, "token"))) return false
  if (!("files" in data && hasOwn(data, "files"))) return false
  if (!(typeof data.token === "string")) return false
  if (!pattern7.test(data.token)) return false
  if (!Number.isInteger(data.files)) return false
  if (!(0 <= data.files)) return false
  if (!(50000 >= data.files)) return false
  if ("library_path" in data && hasOwn(data, "library_path")) {
    if (!(typeof data.library_path === "string")) return false
  }
  for (const key33 of Object.keys(data)) {
    if (key33 !== "token" && key33 !== "files" && key33 !== "library_path") return false
  }
  return true
};
const ref86 = function validate(data) {
  if (!ref87(data)) return false
  return true
};
const ref91 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (!(data === "trace" || data === "debug" || data === "info" || data === "warn" || data === "error" || data === "fatal" || data === "panic")) return false
  return true
};
const ref90 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("time" in data && hasOwn(data, "time"))) return false
  if (!("level" in data && hasOwn(data, "level"))) return false
  if (!("message" in data && hasOwn(data, "message"))) return false
  if (!("details" in data && hasOwn(data, "details"))) return false
  if (!(typeof data.time === "string")) return false
  if (!format0(data.time)) return false
  if (!ref91(data.level)) return false
  if (!(typeof data.message === "string")) return false
  if (!(typeof data.details === "string")) return false
  for (const key34 of Object.keys(data)) {
    if (key34 !== "time" && key34 !== "level" && key34 !== "message" && key34 !== "details") return false
  }
  return true
};
const ref89 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("entries" in data && hasOwn(data, "entries"))) return false
  if (!Array.isArray(data.entries)) return false
  if (data.entries.length > 15) return false
  for (let y = 0; y < data.entries.length; y++) {
    if (y in data.entries && hasOwn(data.entries, y)) {
      if (!ref90(data.entries[y])) return false
    }
  }
  if ("next_cursor" in data && hasOwn(data, "next_cursor")) {
    if (!(typeof data.next_cursor === "string")) return false
    if (data.next_cursor.length > 128 && stringLength(data.next_cursor) > 128) return false
  }
  for (const key35 of Object.keys(data)) {
    if (key35 !== "entries" && key35 !== "next_cursor") return false
  }
  return true
};
const ref88 = function validate(data) {
  if (!ref89(data)) return false
  return true
};
const ref92 = function validate(data) {
  if (!ref90(data)) return false
  return true
};
const ref93 = function validate(data) {
  if (!ref91(data)) return false
  return true
};
const ref94 = function validate(data) {
  if (!ref13(data)) return false
  return true
};
const ref95 = function validate(data) {
  if (!ref14(data)) return false
  return true
};
const ref97 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("id" in data && hasOwn(data, "id"))) return false
  if (!("source_path" in data && hasOwn(data, "source_path"))) return false
  if (!("configured_source_path" in data && hasOwn(data, "configured_source_path"))) return false
  if (!("library_path" in data && hasOwn(data, "library_path"))) return false
  if (!("incoming" in data && hasOwn(data, "incoming"))) return false
  if (!("outgoing" in data && hasOwn(data, "outgoing"))) return false
  if (!("paused_rules" in data && hasOwn(data, "paused_rules"))) return false
  if (!("same_folder" in data && hasOwn(data, "same_folder"))) return false
  if (!ref14(data.id)) return false
  if (!(typeof data.source_path === "string")) return false
  if (data.source_path.length > 4096 && stringLength(data.source_path) > 4096) return false
  if (!(typeof data.configured_source_path === "string")) return false
  if (!(typeof data.library_path === "string")) return false
  if (!Number.isInteger(data.incoming)) return false
  if (!(0 <= data.incoming)) return false
  if (!(9007199254740991 >= data.incoming)) return false
  if (!Number.isInteger(data.outgoing)) return false
  if (!(0 <= data.outgoing)) return false
  if (!(9007199254740991 >= data.outgoing)) return false
  if (!Number.isInteger(data.paused_rules)) return false
  if (!(0 <= data.paused_rules)) return false
  if (!(9007199254740991 >= data.paused_rules)) return false
  if (!(typeof data.same_folder === "boolean")) return false
  for (const key36 of Object.keys(data)) {
    if (key36 !== "id" && key36 !== "source_path" && key36 !== "configured_source_path" && key36 !== "library_path" && key36 !== "incoming" && key36 !== "outgoing" && key36 !== "paused_rules" && key36 !== "same_folder") return false
  }
  return true
};
const ref96 = function validate(data) {
  if (!ref97(data)) return false
  return true
};
const ref99 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("path" in data && hasOwn(data, "path"))) return false
  if (!("parent" in data && hasOwn(data, "parent"))) return false
  if (!("entries" in data && hasOwn(data, "entries"))) return false
  if (!(typeof data.path === "string")) return false
  if (!(typeof data.parent === "string")) return false
  if (!Array.isArray(data.entries)) return false
  for (let z = 0; z < data.entries.length; z++) {
    if (z in data.entries && hasOwn(data.entries, z)) {
      if (!(typeof data.entries[z] === "string")) return false
    }
  }
  for (const key37 of Object.keys(data)) {
    if (key37 !== "path" && key37 !== "parent" && key37 !== "entries") return false
  }
  return true
};
const ref98 = function validate(data) {
  if (!ref99(data)) return false
  return true
};
const ref100 = function validate(data) {
  if (!ref16(data)) return false
  return true
};
const ref101 = function validate(data) {
  if (!ref17(data)) return false
  return true
};
const ref102 = function validate(data) {
  if (!ref18(data)) return false
  return true
};
const ref103 = function validate(data) {
  if (!ref19(data)) return false
  return true
};
const ref104 = function validate(data) {
  if (!ref20(data)) return false
  return true
};
const ref105 = function validate(data) {
  if (!ref23(data)) return false
  return true
};
const ref107 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("version" in data && hasOwn(data, "version"))) return false
  if (!(typeof data.version === "string")) return false
  for (const key38 of Object.keys(data)) {
    if (key38 !== "version") return false
  }
  return true
};
const ref106 = function validate(data) {
  if (!ref107(data)) return false
  return true
};
const ref111 = function validate(data) {
  if (!(typeof data === "string")) return false
  if (!(data === "book" || data === "cover")) return false
  return true
};
const ref110 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("document_id" in data && hasOwn(data, "document_id"))) return false
  if (!("kind" in data && hasOwn(data, "kind"))) return false
  if (!(typeof data.document_id === "string")) return false
  if (!ref111(data.kind)) return false
  for (const key39 of Object.keys(data)) {
    if (key39 !== "document_id" && key39 !== "kind") return false
  }
  return true
};
const ref109 = function validate(data) {
  if (!(typeof data === "object" && data && !Array.isArray(data))) return false
  if (!("type" in data && hasOwn(data, "type"))) return false
  if (!("title" in data && hasOwn(data, "title"))) return false
  if (!("status" in data && hasOwn(data, "status"))) return false
  if (!("code" in data && hasOwn(data, "code"))) return false
  if (!("detail" in data && hasOwn(data, "detail"))) return false
  if (!(typeof data.type === "string")) return false
  if (!(typeof data.title === "string")) return false
  if (!Number.isInteger(data.status)) return false
  if (!(400 <= data.status)) return false
  if (!(599 >= data.status)) return false
  if (!(typeof data.code === "string")) return false
  if (!(typeof data.detail === "string")) return false
  if ("current_revision" in data && hasOwn(data, "current_revision")) {
    if (!ref58(data.current_revision)) return false
  }
  if ("backup_path_issue" in data && hasOwn(data, "backup_path_issue")) {
    if (!ref110(data.backup_path_issue)) return false
  }
  for (const key40 of Object.keys(data)) {
    if (key40 !== "type" && key40 !== "title" && key40 !== "status" && key40 !== "code" && key40 !== "detail" && key40 !== "current_revision" && key40 !== "backup_path_issue") return false
  }
  return true
};
const ref108 = function validate(data) {
  if (!ref109(data)) return false
  return true
};
const ref112 = function validate(data) {
  if (!ref110(data)) return false
  return true
};
const ref113 = function validate(data) {
  if (!ref111(data)) return false
  return true
};
return ([
  ref0,
  ref5,
  ref8,
  ref10,
  ref12,
  ref15,
  ref21,
  ref22,
  ref24,
  ref27,
  ref28,
  ref29,
  ref31,
  ref33,
  ref35,
  ref38,
  ref39,
  ref44,
  ref45,
  ref46,
  ref47,
  ref48,
  ref49,
  ref50,
  ref51,
  ref53,
  ref54,
  ref56,
  ref59,
  ref60,
  ref63,
  ref64,
  ref67,
  ref68,
  ref72,
  ref73,
  ref74,
  ref77,
  ref78,
  ref81,
  ref82,
  ref83,
  ref84,
  ref86,
  ref88,
  ref92,
  ref93,
  ref94,
  ref95,
  ref96,
  ref98,
  ref100,
  ref101,
  ref102,
  ref103,
  ref104,
  ref105,
  ref106,
  ref108,
  ref112,
  ref113
])})();
