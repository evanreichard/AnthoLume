// Misc Consts
const SW_VERSION = 1;
const SW_CACHE_NAME = "OFFLINE_V1";

// Message Types
const PURGE_SW_CACHE = "PURGE_SW_CACHE";
const DEL_SW_CACHE = "DEL_SW_CACHE";
const GET_SW_CACHE = "GET_SW_CACHE";
const GET_SW_VERSION = "GET_SW_VERSION";

// Cache Types
const CACHE_ONLY = "CACHE_ONLY";
const CACHE_NEVER = "CACHE_NEVER";
const CACHE_UPDATE_SYNC = "CACHE_UPDATE_SYNC";
const CACHE_UPDATE_ASYNC = "CACHE_UPDATE_ASYNC";

/**
 * Define routes and their directives. Takes `routes`, `type`, and `fallback`.
 *
 * Routes (Required):
 *   Either a string of the exact request, or a RegExp. Order precedence.
 *
 * Fallback (Optional):
 *   A fallback function. If the request fails, this function is executed and
 *   its return value is returned as the result.
 *
 * Types (Required):
 *   - CACHE_ONLY
 *       Cache once & never refresh.
 *   - CACHE_NEVER
 *       Never cache & always perform a request.
 *   - CACHE_UPDATE_SYNC
 *       Update cache & return result.
 *   - CACHE_UPDATE_ASYNC
 *       Return cache if exists & update cache in background.
 **/
const ROUTES = [
  { route: "/local", type: CACHE_UPDATE_ASYNC },
  { route: "/reader", type: CACHE_UPDATE_ASYNC },
  { route: "/manifest.json", type: CACHE_UPDATE_ASYNC },
  { route: /^\/assets\//, type: CACHE_UPDATE_ASYNC },
  {
    route: /^\/documents\/[a-zA-Z0-9]{32}\/(cover|file)$/,
    type: CACHE_UPDATE_ASYNC,
  },
  {
    route: /^\/documents\/[a-zA-Z0-9]{32}\/progress$/,
    type: CACHE_UPDATE_SYNC,
  },
  {
    route: /.*/,
    type: CACHE_NEVER,
    fallback: (event) => caches.match("/local"),
  },
];

/**
 * These are assets that are cached on initial service worker installation.
 **/
const PRECACHE_ASSETS = [
  // Offline & Reader Assets
  "/local",
  "/reader",
  "/assets/local/index.js",
  "/assets/reader/index.js",
  "/assets/images/no-cover.jpg",
  "/assets/reader/readerThemes.css",

  // Main App Assets
  "/manifest.json",
  "/assets/index.js",
  "/assets/style.css",
  "/assets/common.js",

  // Library Assets
  "/assets/lib/platform.min.js",
  "/assets/lib/jszip.min.js",
  "/assets/lib/epub.min.js",
  "/assets/lib/no-sleep.min.js",
  "/assets/lib/idb-keyval.min.js",
];

// ------------------------------------------------------- //
// ----------------------- Helpers ----------------------- //
// ------------------------------------------------------- //

function purgeCache() {
  console.log("[purgeCache] Purging Cache");
  return caches.keys().then(function (names) {
    for (let name of names) caches.delete(name);
  });
}

async function updateCache(request) {
  let url = request.url ? new URL(request.url).pathname : request;
  console.log("[updateCache] Updating Cache:", url);

  let cache = await caches.open(SW_CACHE_NAME);

  return fetch(request)
    .then((response) => {
      const resClone = response.clone();
      if (response.status < 400) cache.put(request, resClone);
      return response;
    })
    .catch((e) => {
      console.log("[updateCache] Updating Cache Failed:", url);
      throw e;
    });
}

// ------------------------------------------------------- //
// ------------------- Event Listeners ------------------- //
// ------------------------------------------------------- //

async function handleFetch(event) {
  // Get Path
  let url = new URL(event.request.url).pathname;

  // Find Directive
  const directive = ROUTES.find(
    (item) => url.match(item.route) || url == item.route
  ) || { type: CACHE_NEVER };

  // Get Fallback
  const fallbackFunc = (event) => {
    console.log("[handleFetch] Fallback:", { url, directive });
    if (directive.fallback) return directive.fallback(event);
  };

  console.log("[handleFetch] Processing:", { url, directive });

  // Get Current Cache
  let currentCache = await caches.match(event.request);

  // Perform Caching Method
  switch (directive.type) {
    case CACHE_NEVER:
      return fetch(event.request).catch((e) => fallbackFunc(event));
    case CACHE_ONLY:
      return (
        currentCache ||
        updateCache(event.request).catch((e) => fallbackFunc(event))
      );
    case CACHE_UPDATE_SYNC:
      return updateCache(event.request).catch(
        (e) => currentCache || fallbackFunc(event)
      );
    case CACHE_UPDATE_ASYNC:
      let newResponse = updateCache(event.request).catch((e) =>
        fallbackFunc(event)
      );

      return currentCache || newResponse;
  }
}

function handleMessage(event) {
  console.log("[handleMessage] Received Message:", event.data);
  let { id, data } = event.data;

  if (data.type === GET_SW_VERSION) {
    event.source.postMessage({ id, data: SW_VERSION });
  } else if (data.type === PURGE_SW_CACHE) {
    purgeCache()
      .then(() => event.source.postMessage({ id, data: "SUCCESS" }))
      .catch(() => event.source.postMessage({ id, data: "FAILURE" }));
  } else if (data.type === GET_SW_CACHE) {
    caches.open(SW_CACHE_NAME).then(async (cache) => {
      let allKeys = await cache.keys();

      let docResources = allKeys
        .map((item) => new URL(item.url).pathname)
        .filter((item) => item.startsWith("/documents/"));

      let documentIDs = Array.from(
        new Set(docResources.map((item) => item.split("/")[2]))
      );

      /**
       * Filter for cached items only. Attempt to fetch updated result. If
       * failure, return cached version. This ensures we return the most up to
       * date version possible.
       **/
      let cachedDocuments = await Promise.all(
        documentIDs
          .filter(
            (id) =>
              docResources.includes("/documents/" + id + "/file") &&
              docResources.includes("/documents/" + id + "/progress")
          )
          .map(async (id) => {
            let url = "/documents/" + id + "/progress";
            let currentCache = await caches.match(url);
            let resp = await updateCache(url).catch((e) => currentCache);
            return resp.json();
          })
      );

      event.source.postMessage({ id, data: cachedDocuments });
    });
  } else if (data.type === DEL_SW_CACHE) {
    let basePath = "/documents/" + data.id;
    caches
      .open(SW_CACHE_NAME)
      .then((cache) =>
        Promise.all([
          cache.delete(basePath + "/file"),
          cache.delete(basePath + "/progress"),
        ])
      )
      .then(() => event.source.postMessage({ id, data: "SUCCESS" }))
      .catch(() => event.source.postMessage({ id, data: "FAILURE" }));
  } else {
    event.source.postMessage({ id, data: { pong: 1 } });
  }
}

async function handleInstall(event) {
  let cache = await caches.open(SW_CACHE_NAME);
  return cache.addAll(PRECACHE_ASSETS);
}

self.addEventListener("message", handleMessage);

self.addEventListener("install", function (event) {
  event.waitUntil(handleInstall(event));
});

self.addEventListener("fetch", (event) =>
  event.respondWith(handleFetch(event))
);
