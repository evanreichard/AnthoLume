export interface paths {
    "/api/v1/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listDocuments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Synthetic EPUB only. No range, conditional, or resumability promise in this proof. */
        get: operations["downloadDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Bounded synthetic validation only; no file publication or document creation. */
        post: operations["uploadDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/reading-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["submitProgress"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["submitActivity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/probe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["adminProbe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Problem: {
            type: string;
            title: string;
            status: number;
            code: string;
            detail: string;
            current_revision?: string;
        };
        Document: {
            id: string;
            title: string | null;
            author: string | null;
        };
        DocumentPage: {
            items: components["schemas"]["Document"][];
            page: number;
            page_size: number;
            total: number;
            next_page: number | null;
        };
        ProgressEvent: {
            event_id: string;
            document_id: string;
            device_id: string;
            base_revision: string;
            /** Format: double */
            fraction: number;
            /** @description Opaque unchanged KO XPath */
            position: string;
            /** Format: date-time */
            observed_at: string;
        };
        ActivityEvent: {
            event_id: string;
            document_id: string;
            device_id: string;
            /** Format: date-time */
            start_time: string;
            duration: number;
            /** Format: double */
            start_fraction: number;
            /** Format: double */
            end_fraction: number;
        };
        Receipt: {
            event_id: string;
            /** @enum {string} */
            kind: "progress" | "activity";
            revision: string | null;
        };
        UploadResult: {
            bytes: number;
            /** @enum {string} */
            disposition: "validated_only";
        };
    };
    responses: {
        /** @description Safe common problem; 400 validation, 401 authentication, 403 role/CSRF, 404 missing, 409 identity/revision, 413 bytes, 415 media, 500 storage */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        CSRF: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listDocuments: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stable ID order; offset paging has no cross-request snapshot guarantee */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentPage"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    downloadDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Complete bounded EPUB */
            200: {
                headers: {
                    "Content-Disposition"?: string;
                    "Content-Length"?: number;
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/epub+zip": Blob;
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    uploadDocument: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: Blob;
                };
            };
        };
        responses: {
            /** @description Validated, not persisted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadResult"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    submitProgress: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProgressEvent"];
            };
        };
        responses: {
            /** @description Durable receipt. Exact retry returns original receipt even after later writes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Receipt"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    submitActivity: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActivityEvent"];
            };
        };
        responses: {
            /** @description One durable credited activity and receipt per account/event ID */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Receipt"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    adminProbe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized administrator */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
}
