// Install Service Worker
async function installServiceWorker() {
  // Attempt Installation
  await SW.install()
    .then(() => console.log("[installServiceWorker] Service Worker Installed"))
    .catch((e) =>
      console.log("[installServiceWorker] Service Worker Install Error:", e)
    );
}

// Flush Cached Progress & Activity
async function flushCachedData() {
  let allProgress = await IDB.find(/^PROGRESS-/, true);
  let allActivity = await IDB.get("ACTIVITY");

  console.log("[flushCachedData] Flushing Data:", { allProgress, allActivity });

  Object.entries(allProgress).forEach(([id, progressEvent]) => {
    flushProgress(progressEvent)
      .then(() => {
        console.log("[flushCachedData] Progress Flush Success:", id);
        return IDB.del(id);
      })
      .catch((e) => {
        console.log("[flushCachedData] Progress Flush Failure:", id, e);
      });
  });

  if (!allActivity) return;

  flushActivity(allActivity)
    .then(() => {
      console.log("[flushCachedData] Activity Flush Success");
      return IDB.del("ACTIVITY");
    })
    .catch((e) => {
      console.log("[flushCachedData] Activity Flush Failure", e);
    });
}

function flushActivity(activityEvent) {
  console.log("[flushActivity] Flushing Activity...");

  // Flush Activity
  return fetch("/api/ko/activity", {
    method: "POST",
    body: JSON.stringify(activityEvent),
  }).then(async (r) =>
    console.log("[flushActivity] Flushed Activity:", {
      response: r,
      json: await r.json(),
      data: activityEvent,
    })
  );
}

function flushProgress(progressEvent) {
  console.log("[flushProgress] Flushing Progress...");

  // Flush Progress
  return fetch("/api/ko/syncs/progress", {
    method: "PUT",
    body: JSON.stringify(progressEvent),
  }).then(async (r) =>
    console.log("[flushProgress] Flushed Progress:", {
      response: r,
      json: await r.json(),
      data: progressEvent,
    })
  );
}

// Event Listeners
window.addEventListener("online", flushCachedData);

// Initial Load
flushCachedData();
installServiceWorker();
