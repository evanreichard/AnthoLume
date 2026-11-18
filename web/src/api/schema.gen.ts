export interface paths {
    "/api/v1/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/session/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/session/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/session/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listDocuments"];
        put?: never;
        post: operations["uploadDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        get: operations["getDocument"];
        put?: never;
        post?: never;
        delete: operations["deleteDocument"];
        options?: never;
        head?: never;
        patch: operations["editDocument"];
        trace?: never;
    };
    "/api/v1/metadata/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["lookupMetadata"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/metadata/covers/{cover_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getMetadataCover"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        get: operations["getDocumentCover"];
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
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        get: operations["downloadDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updatePreferences"];
        trace?: never;
    };
    "/api/v1/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/devices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateDevicePreferences"];
        trace?: never;
    };
    "/api/v1/me/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listManagedDevices"];
        put?: never;
        post: operations["registerDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/reading-state/{document_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getReadingState"];
        put?: never;
        post?: never;
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
    "/api/v1/me/insights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getInsights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/insights/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listInsightActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/insights/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listInsightProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/insights/rankings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listInsightRankings"];
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
        ID: string;
        /** Format: uuid */
        EventID: string;
        Revision: string;
        Credentials: {
            username: string;
            password: string;
        };
        User: {
            id: components["schemas"]["ID"];
            is_admin: boolean;
            timezone: string;
        };
        Capabilities: {
            registration_enabled: boolean;
            search_enabled: boolean;
            demo_mode: boolean;
        };
        Session: {
            user: {
                id: components["schemas"]["ID"];
                is_admin: boolean;
                timezone: string;
            } | null;
            csrf_token: string;
            /** Format: date-time */
            expires_at: string | null;
        };
        Document: {
            id: components["schemas"]["ID"];
            title: string | null;
            author: string | null;
            series: string | null;
            description: string | null;
            lang: string | null;
            file_available: boolean;
            cover_available: boolean;
            media_type: string | null;
            /** Format: int64 */
            file_size_bytes: number | null;
            reading_stats?: components["schemas"]["BookReadingStats"];
            added_at?: string;
            last_read_at?: string;
            /** Format: double */
            resume_fraction?: number;
            isbn10?: string;
            isbn13?: string;
        };
        Insights: {
            timezone: string;
            /** Format: date-time */
            as_of: string;
            days: components["schemas"]["InsightDay"][];
            /** Format: int64 */
            seconds_read: number;
            active_days: number;
            current_streak: number;
            longest_streak: number;
            current_week_streak: number;
            longest_week_streak: number;
        };
        InsightDay: {
            /** Format: date */
            date: string;
            /** Format: int64 */
            seconds_read: number;
        };
        InsightActivity: {
            id: string;
            document_id: string;
            title: string;
            available: boolean;
            /** Format: date-time */
            started_at: string;
            /** Format: int64 */
            duration: number;
            /** Format: double */
            start_fraction: number;
            /** Format: double */
            end_fraction: number;
        };
        InsightProgress: {
            document_id: string;
            title: string;
            available: boolean;
            /** Format: date-time */
            updated_at: string;
            /** Format: double */
            fraction: number | null;
        };
        InsightActivityPage: {
            items: components["schemas"]["InsightActivity"][];
            has_more: boolean;
            timezone: string;
        };
        InsightProgressPage: {
            items: components["schemas"]["InsightProgress"][];
            has_more: boolean;
            timezone: string;
        };
        InsightRankings: {
            /** Format: date-time */
            as_of: string;
            items: components["schemas"]["InsightRank"][];
        };
        InsightRank: {
            user: string;
            /** Format: int64 */
            value: number;
        };
        DocumentEdit: {
            title: string;
            author: string;
            description: string;
            isbn10: string;
            isbn13: string;
            cover_base64?: string;
            remove_cover?: boolean;
        };
        MetadataMatch: {
            id: string;
            title: string;
            author: string;
            year?: number;
            /** Format: int64 */
            cover_id?: number;
            description?: string;
            isbn10?: string;
            isbn13?: string;
        };
        /** @description Account-scoped statistics returned on the book detail endpoint. */
        BookReadingStats: {
            /** Format: int64 */
            reading_seconds: number;
            /** Format: int64 */
            words_per_minute: number;
            /** Format: int64 */
            word_count: number | null;
        };
        DocumentPage: {
            items: components["schemas"]["Document"][];
            total: number;
            page: number;
            page_size: number;
            next_page: number | null;
        };
        ReadingState: {
            document_id: components["schemas"]["ID"];
            revision: components["schemas"]["Revision"];
            position: string | null;
            /** Format: double */
            fraction: number | null;
            device_id: string | null;
            /** Format: date-time */
            updated_at: string | null;
        };
        PreferencesUpdate: {
            timezone: string;
        };
        PasswordChange: {
            current_password: string;
            new_password: string;
        };
        DevicePreferences: {
            label: string;
            archived: boolean;
        };
        ManagedDevice: {
            id: components["schemas"]["ID"];
            name: string;
            label: string;
            archived: boolean;
            /** Format: date-time */
            last_synced: string;
        };
        Device: {
            id: components["schemas"]["ID"];
            name: string;
        };
        ProgressEvent: {
            event_id: components["schemas"]["EventID"];
            document_id: components["schemas"]["ID"];
            device_id: components["schemas"]["ID"];
            /** Format: date-time */
            observed_at: string;
            base_revision: components["schemas"]["Revision"];
            position: string;
            /** Format: double */
            fraction: number;
        };
        ActivityEvent: {
            event_id: components["schemas"]["EventID"];
            document_id: components["schemas"]["ID"];
            device_id: components["schemas"]["ID"];
            /** Format: date-time */
            start_time: string;
            duration: number;
            /** Format: double */
            start_fraction: number;
            /** Format: double */
            end_fraction: number;
        };
        Receipt: {
            event_id: components["schemas"]["EventID"];
            /** @enum {string} */
            kind: "progress" | "activity";
            revision: string | null;
        };
        Problem: {
            type: string;
            title: string;
            status: number;
            code: string;
            detail: string;
            current_revision?: components["schemas"]["Revision"];
        };
    };
    responses: {
        /** @description Safe machine-readable error */
        Problem: {
            headers: {
                /** @description Present for temporary unavailability */
                "Retry-After"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
        Origin: string;
        /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
        CSRF: string;
        ID: components["schemas"]["ID"];
    };
    requestBodies: {
        Credentials: {
            content: {
                "application/json": components["schemas"]["Credentials"];
            };
        };
    };
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current or anonymous session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Public deployment capabilities */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Capabilities"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: components["requestBodies"]["Credentials"];
        responses: {
            /** @description Authenticated session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    register: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: components["requestBodies"]["Credentials"];
        responses: {
            /** @description Registered session */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Rotated anonymous session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listDocuments: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
                q?: string;
                sort?: "title" | "author" | "added" | "read";
                resumable?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Shared library */
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
    uploadDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/epub+zip": Blob;
            };
        };
        responses: {
            /** @description The existing or newly uploaded shared book */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Document"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Live document */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Document"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    deleteDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Book removed from the shared library */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    editDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DocumentEdit"];
            };
        };
        responses: {
            /** @description Saved book */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Document"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    lookupMetadata: {
        parameters: {
            query: {
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Suggested metadata, not saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetadataMatch"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getMetadataCover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cover_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Open Library cover preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": Blob;
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getDocumentCover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Existing cover bytes; no metadata lookup */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/*": Blob;
                };
            };
            /** @description Requested range of existing cover bytes */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/*": Blob;
                };
            };
            /** @description Not modified */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    downloadDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Original file; private no-store with safe attachment filename */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "*/*": Blob;
                };
            };
            /** @description Requested range of original file */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "*/*": Blob;
                };
            };
            /** @description Not modified */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unsatisfiable range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    updatePreferences: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesUpdate"];
            };
        };
        responses: {
            /** @description Saved account settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordChange"];
            };
        };
        responses: {
            /** @description Saved account settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    updateDevicePreferences: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path: {
                id: components["parameters"]["ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DevicePreferences"];
            };
        };
        responses: {
            /** @description Saved account settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManagedDevice"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listManagedDevices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owned reading devices */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManagedDevice"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    registerDevice: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Device"];
            };
        };
        responses: {
            /** @description Owned device */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getReadingState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                document_id: components["schemas"]["ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authoritative reading head */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadingState"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    submitProgress: {
        parameters: {
            query?: never;
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
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
            /** @description Immutable original receipt */
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
            header?: {
                /** @description Browser-provided, server-required exact PUBLIC_ORIGIN; never inferred from request Host */
                Origin?: components["parameters"]["Origin"];
                /** @description Server-required random session-bound token, supplied by client middleware; rotates on authentication changes */
                "X-CSRF-Token"?: components["parameters"]["CSRF"];
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
            /** @description Immutable original receipt */
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
    getInsights: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current reading records */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Insights"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listInsightActivity: {
        parameters: {
            query?: {
                page?: number;
                document?: string;
                day?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current reading records */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InsightActivityPage"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listInsightProgress: {
        parameters: {
            query?: {
                page?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current reading records */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InsightProgressPage"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listInsightRankings: {
        parameters: {
            query?: {
                days?: 7 | 30 | 365;
                metric?: "time" | "words" | "pace";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current reading records */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InsightRankings"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
}
