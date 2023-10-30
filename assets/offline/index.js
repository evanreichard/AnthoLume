const GET_SW_CACHE = "GET_SW_CACHE";
const DEL_SW_CACHE = "DEL_SW_CACHE";

// ----------------------------------------------------------------------- //
// --------------------------- Event Listeners --------------------------- //
// ----------------------------------------------------------------------- //

/**
 * Initial load handler. Gets called on DOMContentLoaded.
 **/
async function handleLoad() {
  handleOnlineChange();

  // If SW Redirected
  if (document.location.pathname !== "/offline")
    window.history.replaceState(null, null, "/offline");

  // Create Upload Listener
  let uploadButton = document.querySelector("button");
  uploadButton.addEventListener("click", handleFileAdd);

  // Ensure Installed -> Get Cached Items
  let swCache = await SW.install()
    // Get Service Worker Cache Books
    .then(async () => {
      let swResponse = await SW.send({ type: GET_SW_CACHE });
      return Promise.all(
        // Normalize Cached Results
        swResponse.map(async (item) => {
          let localCache = await IDB.get("PROGRESS-" + item.id);
          if (localCache) {
            item.progress = localCache.progress;
            item.percentage = Math.round(localCache.percentage * 10000) / 100;
          }

          // Additional Values
          item.fileURL = "/documents/" + item.id + "/file";
          item.coverURL = "/documents/" + item.id + "/cover";
          item.type = "REMOTE";

          return item;
        })
      );
    })
    // Fail Nicely -> Allows Local Feature
    .catch((e) => {
      console.log("[loadContent] Service Worker Cache Error:", e);
      return [];
    });

  // Get & Normalize Local Books
  let localResponse = await IDB.find(/^FILE-.{32}$/, false);
  let localCache = await Promise.all(localResponse.map(getLocalProgress));

  // Populate DOM with Cache & Local Books
  populateDOMBooks([...swCache, ...localCache]);
}

/**
 * Update DOM to indicate online status. If no argument is passed, we attempt
 * to determine online status via `navigator.onLine`.
 **/
function handleOnlineChange(isOnline) {
  let onlineEl = document.querySelector("#online");
  isOnline = isOnline == undefined ? navigator.onLine : isOnline;
  onlineEl.hidden = !isOnline;
}

/**
 * Allow deleting local or remote cached files. Deleting remotely cached files
 * does not remove progress. Progress will still be flushed once online.
 **/
async function handleFileDelete(event, item) {
  let mainEl =
    event.target.parentElement.parentElement.parentElement.parentElement
      .parentElement;

  if (item.type == "LOCAL") {
    await IDB.del("FILE-" + item.id);
    await IDB.del("FILE-METADATA-" + item.id);
  } else if (item.type == "REMOTE") {
    let swResp = await SW.send({ type: DEL_SW_CACHE, id: item.id });
    if (swResp != "SUCCESS")
      throw new Error("[handleFileDelete] Service Worker Error");
  }

  console.log("[handleFileDelete] Item Deleted");

  mainEl.remove();
  updateMessage();
}

/**
 * Allow adding file to offline reader. Add to IndexedDB,
 * and later upload? Add style indicating external file?
 **/
async function handleFileAdd() {
  const fileInput = document.getElementById("document_file");
  const file = fileInput.files[0];

  if (!file) return console.log("[handleFileAdd] No File");

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = (error) => reject(error);

      reader.readAsArrayBuffer(file);
    });
  }

  function randomID() {
    return "00000000000000000000000000000000".replace(/[018]/g, (c) =>
      (
        c ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16)
    );
  }

  let newID = randomID();

  readFile(file)
    // Store Blob in IDB
    .then((fileData) => {
      if (!isEpubFile(fileData)) throw new Error("Invalid File Type");

      return IDB.set(
        "FILE-" + newID,
        new Blob([fileData], { type: "application/octet-binary" })
      );
    })
    // Process File
    .then(() => getLocalProgress("FILE-" + newID))
    // Populate in DOM
    .then((item) => populateDOMBooks([item]))
    // Hide Add File Button
    .then(() => {
      let addButtonEl = document.querySelector("#add-file-button");
      addButtonEl.checked = false;
    })
    // Logging
    .then(() => console.log("[handleFileAdd] File Add Successfully"))
    .catch((e) => console.log("[handleFileAdd] File Add Failed:", e));
}

// Add Event Listeners
window.addEventListener("DOMContentLoaded", handleLoad);
window.addEventListener("online", () => handleOnlineChange(true));
window.addEventListener("offline", () => handleOnlineChange(false));

// ----------------------------------------------------------------------- //
// ------------------------------- Helpers ------------------------------- //
// ----------------------------------------------------------------------- //

/**
 * Update the message element. Called after initial load, on item add or on
 * item delete.
 **/
function updateMessage() {
  // Update Loader / No Results Indicator
  let itemsEl = document.querySelector("#items");
  let messageEl = document.querySelector("#message");

  if (itemsEl.children.length == 0) {
    messageEl.innerText = "No Results";
    messageEl.hidden = false;
  } else messageEl.hidden = true;
}

/**
 * Populate DOM with cached documents.
 **/
function populateDOMBooks(data) {
  let allDocuments = document.querySelector("#items");

  // Create Document Items
  data.forEach((item) => {
    // Create Main Element
    let baseEl = document.querySelector("#item-template").cloneNode(true);
    baseEl.removeAttribute("id");

    // Get Elements
    let [titleEl, authorEl, percentageEl] = baseEl.querySelectorAll("p + p");
    let [svgDivEl, textEl] = baseEl.querySelector("strong").children;
    let coverEl = baseEl.querySelector("a img");
    let downloadEl = baseEl.querySelector("svg").parentElement;
    let deleteInputEl = baseEl.querySelector("#delete-button");
    let deleteLabelEl = deleteInputEl.previousElementSibling;
    let deleteTextEl = baseEl.querySelector("input + div span");

    // Set Download Attributes
    downloadEl.setAttribute("href", item.fileURL);
    downloadEl.setAttribute(
      "download",
      item.title + " - " + item.author + ".epub"
    );

    // Set Cover Attributes
    coverEl.setAttribute("src", item.coverURL);
    coverEl.parentElement.setAttribute(
      "href",
      "/reader#id=" + item.id + "&type=" + item.type
    );

    // Set Additional Metadata Attributes
    titleEl.textContent = item.title;
    authorEl.textContent = item.author;
    percentageEl.textContent = item.percentage + "%";

    // Set Remote / Local Indicator
    let newSvgEl =
      item.type == "LOCAL"
        ? document.querySelector("#local-svg-template").cloneNode(true)
        : document.querySelector("#remote-svg-template").cloneNode(true);
    svgDivEl.append(newSvgEl);
    textEl.textContent = item.type;

    // Delete Item
    deleteInputEl.setAttribute("id", "delete-button-" + item.id);
    deleteLabelEl.setAttribute("for", "delete-button-" + item.id);
    deleteTextEl.addEventListener("click", (e) => handleFileDelete(e, item));
    deleteTextEl.textContent =
      item.type == "LOCAL" ? "Delete Local" : "Delete Cache";

    allDocuments.append(baseEl);
  });

  updateMessage();
}

/**
 * Given an item id, generate expected item format from IDB data store.
 **/
async function getLocalProgress(id) {
  // Get Metadata (Cover Always Needed)
  let fileBlob = await IDB.get(id);
  let fileURL = URL.createObjectURL(fileBlob);
  let metadata = await getMetadata(fileURL);

  // Attempt Cache
  let documentID = id.replace("FILE-", "");
  let documentData = await IDB.get("FILE-METADATA-" + documentID);
  if (documentData)
    return { ...documentData, fileURL, coverURL: metadata.coverURL };

  // Create Starting Progress
  let newProgress = {
    id: documentID,
    title: metadata.title,
    author: metadata.author,
    type: "LOCAL",
    percentage: 0,
    progress: "",
    words: 0,
  };

  // Update Cache
  await IDB.set("FILE-METADATA-" + documentID, newProgress);

  // Return Cache + coverURL
  return { ...newProgress, fileURL, coverURL: metadata.coverURL };
}

/**
 * Retrieve the Title, Author, and CoverURL (blob) for a given file.
 **/
async function getMetadata(fileURL) {
  let book = ePub(fileURL, { openAs: "epub" });
  console.log({ book });
  let coverURL = (await book.coverUrl()) || "/assets/images/no-cover.jpg";
  let metadata = await book.loaded.metadata;

  let title =
    metadata.title && metadata.title != "" ? metadata.title : "Unknown";
  let author =
    metadata.creator && metadata.creator != "" ? metadata.creator : "Unknown";

  book.destroy();

  return { title, author, coverURL };
}

/**
 * Validate filetype. We check the headers and validate that they are ZIP.
 * After which we validate contents. This isn't 100% effective, but unless
 * someone is trying to trick it, it should be fine.
 **/
function isEpubFile(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  // Too Small
  if (view.byteLength < 4) {
    return false;
  }

  // Check for the ZIP file signature (PK)
  const littleEndianSignature = view.getUint16(0, true);
  const bigEndianSignature = view.getUint16(0, false);

  if (littleEndianSignature !== 0x504b && bigEndianSignature !== 0x504b) {
    return false;
  }

  // Additional Checks (No FP on ZIP)
  const textDecoder = new TextDecoder();
  const zipContent = textDecoder.decode(new Uint8Array(arrayBuffer));

  if (
    zipContent.includes("mimetype") &&
    zipContent.includes("META-INF/container.xml")
  ) {
    return true;
  }

  return false;
}
