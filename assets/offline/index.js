/**
 * TODO:
 *   - Offling / Online Checker
 *     - Flush oustanding read activity & progress
 *   - No files cached
 *   - Upload Files
 **/

const BASE_ITEM = `
  <div class="w-full relative">
    <div class="flex gap-4 w-full h-full p-4 bg-white shadow-lg dark:bg-gray-700 rounded">
      <div class="min-w-fit my-auto h-48 relative">
	<a href="#">
	  <img class="rounded object-cover h-full" src="/assets/images/no-cover.jpg"></img>
	</a>
      </div>
      <div class="flex flex-col justify-around dark:text-white w-full text-sm">
	<div class="inline-flex shrink-0 items-center">
	  <div>
	      <p class="text-gray-400">Title</p>
	      <p class="font-medium">
		N/A
	      </p>
	  </div>
	</div>
	<div class="inline-flex shrink-0 items-center">
	  <div>
	      <p class="text-gray-400">Author</p>
	      <p class="font-medium">
		N/A
	      </p>
	  </div>
	</div>
	<div class="inline-flex shrink-0 items-center">
	  <div>
	      <p class="text-gray-400">Progress</p>
	      <p class="font-medium">
	      0%
	      </p>
	  </div>
	</div>
      </div>
      <div class="absolute flex flex-col gap-2 right-4 bottom-4 text-gray-500 dark:text-gray-400">
	<a href="#">
	  <svg
	    width="24"
	    height="24"
	    class="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
	    viewBox="0 0 24 24"
	    fill="currentColor"
	    xmlns="http://www.w3.org/2000/svg"
	  >
	    <path
	      fill-rule="evenodd"
	      clip-rule="evenodd"
	      d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12ZM12 6.25C12.4142 6.25 12.75 6.58579 12.75 7V12.1893L14.4697 10.4697C14.7626 10.1768 15.2374 10.1768 15.5303 10.4697C15.8232 10.7626 15.8232 11.2374 15.5303 11.5303L12.5303 14.5303C12.3897 14.671 12.1989 14.75 12 14.75C11.8011 14.75 11.6103 14.671 11.4697 14.5303L8.46967 11.5303C8.17678 11.2374 8.17678 10.7626 8.46967 10.4697C8.76256 10.1768 9.23744 10.1768 9.53033 10.4697L11.25 12.1893V7C11.25 6.58579 11.5858 6.25 12 6.25ZM8 16.25C7.58579 16.25 7.25 16.5858 7.25 17C7.25 17.4142 7.58579 17.75 8 17.75H16C16.4142 17.75 16.75 17.4142 16.75 17C16.75 16.5858 16.4142 16.25 16 16.25H8Z"
	    />
	  </svg>
	</a>
      </div>
    </div>
  </div>`;

const GET_SW_CACHE = "GET_SW_CACHE";
const DEL_SW_CACHE = "DEL_SW_CACHE";

async function initOffline() {
  updateOnlineIndicator();

  if (document.location.pathname !== "/offline")
    window.history.replaceState(null, null, "/offline");

  // Ensure Installed
  await SW.install();

  // Get Service Worker Cache & Local Cache - Override Local
  let swCache = await SW.send({ type: GET_SW_CACHE });
  let allCache = await Promise.all(
    swCache.map(async (item) => {
      let localCache = await IDB.get("PROGRESS-" + item.id);
      if (localCache) {
        item.progress = localCache.progress;
        item.percentage = Math.round(localCache.percentage * 10000) / 100;
      }

      return item;
    })
  );

  populateDOM(allCache);
}

/**
 * Populate DOM with cached documents.
 **/
function populateDOM(data) {
  let allDocuments = document.querySelector("#items");

  // Update Loader / No Results Indicator
  let loadingEl = document.querySelector("#loading");
  if (data.length == 0) loadingEl.innerText = "No Results";
  else loadingEl.remove();

  data.forEach((item) => {
    // Create Main Element
    let baseEl = document.createElement("div");
    baseEl.innerHTML = BASE_ITEM;
    baseEl = baseEl.firstElementChild;

    // Get Elements
    let coverEl = baseEl.querySelector("a img");
    let [titleEl, authorEl, percentageEl] = baseEl.querySelectorAll("p + p");
    let downloadEl = baseEl.querySelector("svg").parentElement;

    // Set Variables
    downloadEl.setAttribute("href", "/documents/" + item.id + "/file");
    coverEl.setAttribute("src", "/documents/" + item.id + "/cover");
    coverEl.parentElement.setAttribute("href", "/reader#id=" + item.id);
    titleEl.textContent = item.title;
    authorEl.textContent = item.author;
    percentageEl.textContent = item.percentage + "%";

    allDocuments.append(baseEl);
  });
}

/**
 * Allow adding file to offline reader. Add to IndexedDB,
 * and later upload? Add style indicating external file?
 **/
function handleFileAdd() {}

function updateOnlineIndicator(isOnline) {
  let onlineEl = document.querySelector("#online");
  isOnline = isOnline == undefined ? navigator.onLine : isOnline;
  onlineEl.hidden = !isOnline;
}

// Initialize
window.addEventListener("DOMContentLoaded", initOffline);
window.addEventListener("online", () => updateOnlineIndicator(true));
window.addEventListener("offline", () => updateOnlineIndicator(false));
