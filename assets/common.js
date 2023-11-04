/**
 * Custom Service Worker Convenience Functions Wrapper
 **/
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

/**
 * Custom IndexedDB Convenience Functions Wrapper
 **/
const IDB = (function () {
  if (!idbKeyval)
    return console.error(
      "[IDB] idbKeyval not found - Did you load idb-keyval?"
    );

  let { get, del, entries, update, keys } = idbKeyval;

  return {
    async set(key, newValue) {
      let changeObj = {};
      await update(key, (oldValue) => {
        if (oldValue != null) changeObj.oldValue = oldValue;
        changeObj.newValue = newValue;
        return newValue;
      });
      return changeObj;
    },

    get(key, defaultValue) {
      return get(key).then((resp) => {
        return defaultValue && resp == null ? defaultValue : resp;
      });
    },

    del(key) {
      return del(key);
    },

    find(keyRegExp, includeValues = false) {
      if (!(keyRegExp instanceof RegExp)) throw new Error("Invalid RegExp");

      if (!includeValues)
        return keys().then((allKeys) =>
          allKeys.filter((key) => keyRegExp.test(key))
        );

      return entries().then((allItems) => {
        const matchingKeys = allItems.filter((keyVal) =>
          keyRegExp.test(keyVal[0])
        );
        return matchingKeys.reduce((obj, keyVal) => {
          const [key, val] = keyVal;
          obj[key] = val;
          return obj;
        }, {});
      });
    },
  };
})();
