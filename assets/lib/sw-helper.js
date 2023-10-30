const SW = (function () {
  // Helper Function
  function randomID() {
    return "00000000000000000000000000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4))))
        .toString(16)
        .toUpperCase()
    );
  }

  // Variables
  let swInstance = null;
  let outstandingMessages = {};

  navigator.serviceWorker?.addEventListener("message", ({ data }) => {
    let { id } = data;
    data = data.data;

    console.log("[SW] Received Message:", { id, data });
    if (!outstandingMessages[id])
      return console.warn("[SW] Invalid Outstanding Message:", { id, data });

    outstandingMessages[id](data);
    delete outstandingMessages[id];
  });

  async function install() {
    if (!navigator.serviceWorker)
      throw new Error("Service Worker Not Supported");

    // Register Service Worker
    swInstance = await navigator.serviceWorker.register("/sw.js");
    swInstance.onupdatefound = (data) =>
      console.log("[SW.install] Update Found:", data);

    // Wait for Registration / Update
    let serviceWorker =
      swInstance.installing || swInstance.waiting || swInstance.active;

    // Await Installation
    await new Promise((resolve) => {
      serviceWorker.onstatechange = (data) => {
        console.log("[SW.install] State Change:", serviceWorker.state);
        if (["installed", "activated"].includes(serviceWorker.state)) resolve();
      };

      console.log("[SW.install] Current State:", serviceWorker.state);
      if (["installed", "activated"].includes(serviceWorker.state)) resolve();
    });
  }

  function send(data) {
    if (!swInstance?.active) return Promise.reject("Inactive Service Worker");
    let id = randomID();

    let msgPromise = new Promise((resolve) => {
      outstandingMessages[id] = resolve;
    });

    swInstance.active.postMessage({ id, data });
    return msgPromise;
  }

  return { install, send };
})();
