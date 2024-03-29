const THEMES = ["light", "tan", "blue", "gray", "black"];
const THEME_FILE = "/assets/reader/themes.css";

/**
 * Initial load handler. Gets called on DOMContentLoaded. Responsible for
 * normalizing the documentData depending on type (REMOTE or LOCAL), and
 * populating the metadata of the book into the DOM.
 **/
async function initReader() {
  let documentData;
  let filePath;

  // Get Document ID & Type
  const urlParams = new URLSearchParams(window.location.hash.slice(1));
  const documentID = urlParams.get("id");
  const documentType = urlParams.get("type");

  if (documentType == "REMOTE") {
    // Get Server / Cached Document
    let progressResp = await fetch("/reader/progress/" + documentID);
    documentData = await progressResp.json();

    // Update With Local Cache
    let localCache = await IDB.get("PROGRESS-" + documentID);
    if (localCache) {
      documentData.progress = localCache.progress;
      documentData.percentage = Math.round(localCache.percentage * 10000) / 100;
    }

    filePath = "/documents/" + documentID + "/file";
  } else if (documentType == "LOCAL") {
    documentData = await IDB.get("FILE-METADATA-" + documentID);
    let fileBlob = await IDB.get("FILE-" + documentID);
    filePath = URL.createObjectURL(fileBlob);
  } else {
    throw new Error("Invalid Type");
  }

  // Update Type
  documentData.type = documentType;

  // Populate Metadata & Create Reader
  window.currentReader = new EBookReader(filePath, documentData);
  populateMetadata(documentData);
}

/**
 * Populates metadata into the DOM. Specifically for the top "drop" down.
 **/
function populateMetadata(data) {
  let documentLocation =
    data.type == "LOCAL" ? "/local" : "/documents/" + data.id;

  let documentCoverLocation =
    data.type == "LOCAL"
      ? "/assets/images/no-cover.jpg"
      : "/documents/" + data.id + "/cover";

  let [backEl, coverEl] = document.querySelectorAll("a");
  backEl.setAttribute("href", documentLocation);
  coverEl.setAttribute("href", documentLocation);
  coverEl.firstElementChild.setAttribute("src", documentCoverLocation);

  let [titleEl, authorEl] = document.querySelectorAll("#top-bar p + p");
  titleEl.innerText = data.title;
  authorEl.innerText = data.author;
}

/**
 * This is the main reader class. All functionality is wrapped in this class.
 * Responsible for handling gesture / clicks, flushing progress & activity,
 * storing and processing themes, etc.
 **/
class EBookReader {
  bookState = {
    pages: 0,
    percentage: 0,
    progress: "",
    progressElement: null,
    readActivity: [],
    words: 0,
  };

  constructor(file, bookState) {
    // Set Variables
    Object.assign(this.bookState, bookState);

    // Load Settings
    this.loadSettings();

    // Load EPUB
    this.book = ePub(file, { openAs: "epub" });

    // Render
    this.rendition = this.book.renderTo("viewer", {
      manager: "default",
      flow: "paginated",
      width: "100%",
      height: "100%",
      allowScriptedContent: true,
    });

    // Setup Reader
    this.book.ready.then(this.setupReader.bind(this));

    // Initialize
    this.initCSP();
    this.initDevice();
    this.initWakeLock();
    this.initThemes();
    this.initViewerListeners();
    this.initDocumentListeners();
  }

  /**
   * Load progress and generate locations
   **/
  async setupReader() {
    // Get Word Count
    this.bookState.words = await this.countWords();

    // Load Progress
    let { cfi } = await this.getCFIFromXPath(this.bookState.progress);

    // Update Position
    await this.setPosition(cfi);

    // Highlight Element - DOM Has Element
    let { element } = await this.getCFIFromXPath(this.bookState.progress);

    // Set Progress Element & Highlight
    this.bookState.progressElement = element;
    this.highlightPositionMarker();

    // Update Stats & Page Start
    let stats = await this.getBookStats();
    this.updateBookStatElements(stats);
    this.bookState.pageStart = Date.now();
  }

  initDevice() {
    function randomID() {
      return "00000000000000000000000000000000".replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4))))
          .toString(16)
          .toUpperCase(),
      );
    }

    // Device Already Set
    if (this.readerSettings.deviceID) return;

    // Get Elements
    let devicePopup = document.querySelector("#device-selector");
    let devSelector = devicePopup.querySelector("select");
    let devInput = devicePopup.querySelector("input");
    let [assumeButton, createButton] = devicePopup.querySelectorAll("button");

    // Set Visible
    devicePopup.classList.remove("hidden");

    // Add Devices
    fetch("/reader/devices").then(async (r) => {
      let data = await r.json();

      data.forEach((item) => {
        let optionEl = document.createElement("option");
        optionEl.value = item.id;
        optionEl.textContent = item.device_name;
        devSelector.appendChild(optionEl);
      });
    });

    assumeButton.addEventListener("click", () => {
      let deviceID = devSelector.value;

      if (deviceID == "") {
        // TODO - Error Message
        return;
      }

      let selectedOption = devSelector.children[devSelector.selectedIndex];
      let deviceName = selectedOption.textContent;

      this.readerSettings.deviceID = deviceID;
      this.readerSettings.deviceName = deviceName;
      this.saveSettings();
      devicePopup.classList.add("hidden");
    });

    createButton.addEventListener("click", () => {
      let deviceName = devInput.value.trim();

      if (deviceName == "") {
        // TODO - Error Message
        return;
      }

      this.readerSettings.deviceID = randomID();
      this.readerSettings.deviceName = deviceName;
      this.saveSettings();
      devicePopup.classList.add("hidden");
    });
  }

  /**
   * This is a hack and maintains a wake lock. It will automatically disable
   * if there's been no input for 10 minutes.
   *
   * Ideally we use "navigator.wakeLock", but there's a bug in Safari (as of
   * iOS 17.03) when intalled as a PWA that doesn't allow it to work [0]
   *
   * Unfortunate downside is iOS indicates that "No Sleep" is playing in both
   * the Control Center and Lock Screen. iOS also stops any background sound.
   *
   * [0] https://progressier.com/pwa-capabilities/screen-wake-lock
   **/
  initWakeLock() {
    // Setup Wake Lock (Adding to DOM Necessary - iOS 17.03)
    let timeoutID = null;
    let wakeLock = new NoSleep();

    // Override Standalone (Modified No-Sleep)
    if (window.navigator.standalone) {
      Object.assign(wakeLock.noSleepVideo.style, {
        position: "absolute",
        top: "-100%",
      });
      document.body.append(wakeLock.noSleepVideo);
    }

    // User Action Required (Manual bubble up from iFrame)
    document.addEventListener("wakelock", function () {
      // 10 Minute Timeout
      if (timeoutID) clearTimeout(timeoutID);
      timeoutID = setTimeout(wakeLock.disable, 1000 * 60 * 10);

      // Enable
      wakeLock.enable();
    });
  }

  /**
   * Register all themes with reader
   **/
  initThemes() {
    // Register Themes
    THEMES.forEach((theme) =>
      this.rendition.themes.register(theme, THEME_FILE),
    );

    let themeLinkEl = document.createElement("link");
    themeLinkEl.setAttribute("id", "themes");
    themeLinkEl.setAttribute("rel", "stylesheet");
    themeLinkEl.setAttribute("href", THEME_FILE);
    document.head.append(themeLinkEl);

    // Set Theme Style
    this.rendition.themes.default({
      "*": {
        "font-size": "var(--editor-font-size) !important",
        "font-family": "var(--editor-font-family) !important",
      },
    });

    // Restore Theme Hook
    this.rendition.hooks.content.register(
      function () {
        // Restore Theme
        this.setTheme();

        // Set Fonts
        this.rendition.getContents().forEach((c) => {
          let el = c.document.head.appendChild(
            c.document.createElement("link"),
          );
          el.setAttribute("rel", "stylesheet");
          el.setAttribute("href", "/assets/reader/fonts.css");
        });
      }.bind(this),
    );
  }

  /**
   * EpubJS will set iframe sandbox when settings "allowScriptedContent: false".
   * However, Safari completely blocks us from attaching listeners to the iframe
   * document. So instead we just inject a restrictive CSP rule.
   *
   * This effectively blocks all script content within the iframe while still
   * allowing us to attach listeners to the iframe document.
   **/
  initCSP() {
    // Derive CSP Host
    var protocol = document.location.protocol;
    var host = document.location.host;
    var cspURL = `${protocol}//${host}`;

    // Add CSP Policy
    this.book.spine.hooks.content.register((output, section) => {
      let cspWrapper = document.createElement("div");
      cspWrapper.innerHTML = `
	<meta
	  http-equiv="Content-Security-Policy"
	  content="require-trusted-types-for 'script';
		   style-src 'self' blob: 'unsafe-inline' ${cspURL};
		   object-src 'none';
		   script-src 'none';"
	>`;
      let cspMeta = cspWrapper.children[0];
      output.head.append(cspMeta);
    });
  }

  /**
   * Set theme & meta theme color
   **/
  setTheme(newTheme) {
    // Assert Theme Object
    this.readerSettings.theme =
      typeof this.readerSettings.theme == "object"
        ? this.readerSettings.theme
        : {};

    // Assign Values
    Object.assign(this.readerSettings.theme, newTheme);

    // Get Desired Theme (Defaults)
    let colorScheme = this.readerSettings.theme.colorScheme || "tan";
    let fontFamily = this.readerSettings.theme.fontFamily || "serif";
    let fontSize = this.readerSettings.theme.fontSize || 1;

    // Set Reader Theme
    this.rendition.themes.select(colorScheme);

    // Get Reader Theme
    let themeColorEl = document.querySelector("[name='theme-color']");
    let themeStyleSheet = document.querySelector("#themes").sheet;
    let themeStyleRule = Array.from(themeStyleSheet.cssRules).find(
      (item) => item.selectorText == "." + colorScheme,
    );

    // Match Reader Theme
    if (!themeStyleRule) return;
    let backgroundColor = themeStyleRule.style.backgroundColor;
    themeColorEl.setAttribute("content", backgroundColor);
    document.body.style.backgroundColor = backgroundColor;

    // Set Font Family & Highlight Style
    this.rendition.getContents().forEach((item) => {
      // Set Font Family
      item.document.documentElement.style.setProperty(
        "--editor-font-family",
        fontFamily,
      );

      // Set Font Size
      item.document.documentElement.style.setProperty(
        "--editor-font-size",
        fontSize + "em",
      );

      // Set Highlight Style
      item.document.querySelectorAll(".highlight").forEach((el) => {
        Object.assign(el.style, {
          background: backgroundColor,
        });
      });
    });

    // Save Settings (Theme)
    this.saveSettings();
  }

  /**
   * Takes existing progressElement and applies the highlight style to it.
   * This is nice when font size or font family changes as it can cause
   * the position to move.
   **/
  highlightPositionMarker() {
    if (!this.bookState.progressElement) return;

    // Remove Existing
    this.rendition.getContents().forEach((item) => {
      item.document.querySelectorAll(".highlight").forEach((el) => {
        el.removeAttribute("style");
        el.classList.remove("highlight");
      });
    });

    // Compute Style
    let backgroundColor = getComputedStyle(
      this.bookState.progressElement.ownerDocument.body,
    ).backgroundColor;

    // Set Style
    Object.assign(this.bookState.progressElement.style, {
      background: backgroundColor,
      filter: "invert(0.2)",
    });

    // Update Class
    this.bookState.progressElement.classList.add("highlight");
  }

  /**
   * Viewer Listeners
   **/
  initViewerListeners() {
    /**
     * Initiate the debounce when the given function returns true.
     * Don't run it again until the timeout lapses.
     **/
    function debounceFunc(fn, d) {
      let timer;
      let bouncing = false;
      return function () {
        let context = this;
        let args = arguments;

        if (bouncing) return;
        if (!fn.apply(context, args)) return;

        bouncing = true;
        clearTimeout(timer);
        timer = setTimeout(() => {
          bouncing = false;
        }, d);
      };
    }

    // Elements
    let topBar = document.querySelector("#top-bar");
    let bottomBar = document.querySelector("#bottom-bar");

    // Local Functions
    let nextPage = this.nextPage.bind(this);
    let prevPage = this.prevPage.bind(this);

    // ------------------------------------------------ //
    // ----------------- Swipe Helpers ---------------- //
    // ------------------------------------------------ //
    let touchStartX,
      touchStartY,
      touchEndX,
      touchEndY = undefined;

    function handleGesture(event) {
      let drasticity = 75;

      // Swipe Down
      if (touchEndY - drasticity > touchStartY) {
        return handleSwipeDown();
      }

      // Swipe Up
      if (touchEndY + drasticity < touchStartY) {
        // Prioritize Down & Up Swipes
        return handleSwipeUp();
      }

      // Swipe Left
      if (touchEndX + drasticity < touchStartX) {
        nextPage();
      }

      // Swipe Right
      if (touchEndX - drasticity > touchStartX) {
        prevPage();
      }
    }

    function handleSwipeDown() {
      if (bottomBar.classList.contains("bottom-0"))
        bottomBar.classList.remove("bottom-0");
      else topBar.classList.add("top-0");
    }

    function handleSwipeUp() {
      if (topBar.classList.contains("top-0")) topBar.classList.remove("top-0");
      else bottomBar.classList.add("bottom-0");
    }

    this.rendition.hooks.render.register(function (doc, data) {
      let renderDoc = doc.document;

      // ------------------------------------------------ //
      // ---------------- Wake Lock Hack ---------------- //
      // ------------------------------------------------ //
      let wakeLockListener = function () {
        renderDoc.dispatchEvent(new CustomEvent("wakelock"));
      };
      renderDoc.addEventListener("click", wakeLockListener);
      renderDoc.addEventListener("gesturechange", wakeLockListener);
      renderDoc.addEventListener("touchstart", wakeLockListener);

      // ------------------------------------------------ //
      // --------------- Bars & Page Turn --------------- //
      // ------------------------------------------------ //
      renderDoc.addEventListener(
        "click",
        function (event) {
          // Get Window Dimensions
          let windowWidth = window.innerWidth;
          let windowHeight = window.innerHeight;

          // Calculate X & Y Hot Zones
          let barPixels = windowHeight * 0.2;
          let pagePixels = windowWidth * 0.2;

          // Calculate Top & Bottom Thresholds
          let top = barPixels;
          let bottom = window.innerHeight - top;

          // Calculate Left & Right Thresholds
          let left = pagePixels;
          let right = windowWidth - left;

          // Calculate Relative Coords
          let leftOffset = this.views().container.scrollLeft;
          let yCoord = event.clientY;
          let xCoord = event.clientX - leftOffset;

          // Handle Event
          if (yCoord < top) handleSwipeDown();
          else if (yCoord > bottom) handleSwipeUp();
          else if (xCoord < left) prevPage();
          else if (xCoord > right) nextPage();
          else {
            bottomBar.classList.remove("bottom-0");
            topBar.classList.remove("top-0");
          }
        }.bind(this),
      );

      renderDoc.addEventListener(
        "wheel",
        debounceFunc((event) => {
          if (event.deltaY > 25) {
            handleSwipeUp();
            return true;
          }
          if (event.deltaY < -25) {
            handleSwipeDown();
            return true;
          }
        }, 400),
      );

      // ------------------------------------------------ //
      // ------------------- Gestures ------------------- //
      // ------------------------------------------------ //

      renderDoc.addEventListener(
        "touchstart",
        function (event) {
          touchStartX = event.changedTouches[0].screenX;
          touchStartY = event.changedTouches[0].screenY;
        },
        false,
      );

      renderDoc.addEventListener(
        "touchend",
        function (event) {
          touchEndX = event.changedTouches[0].screenX;
          touchEndY = event.changedTouches[0].screenY;
          handleGesture(event);
        },
        false,
      );
    });
  }

  /**
   * Document listeners
   **/
  initDocumentListeners() {
    // Elements
    let topBar = document.querySelector("#top-bar");

    let nextPage = this.nextPage.bind(this);
    let prevPage = this.prevPage.bind(this);

    // ------------------------------------------------ //
    // -------------- Keyboard Shortcuts -------------- //
    // ------------------------------------------------ //
    document.addEventListener(
      "keyup",
      function (e) {
        // Left Key (Previous Page)
        if ((e.keyCode || e.which) == 37) {
          prevPage();
        }

        // Right Key (Next Page)
        if ((e.keyCode || e.which) == 39) {
          nextPage();
        }

        // "t" Key (Theme Cycle)
        if ((e.keyCode || e.which) == 84) {
          let currentThemeIdx = THEMES.indexOf(
            this.readerSettings.theme.colorScheme,
          );
          let colorScheme =
            THEMES.length == currentThemeIdx + 1
              ? THEMES[0]
              : THEMES[currentThemeIdx + 1];
          this.setTheme({ colorScheme });
        }
      }.bind(this),
      false,
    );

    // Color Scheme Switcher
    document.querySelectorAll(".color-scheme").forEach(
      function (item) {
        item.addEventListener(
          "click",
          function (event) {
            let colorScheme = event.target.innerText;
            this.setTheme({ colorScheme });
          }.bind(this),
        );
      }.bind(this),
    );

    // Font Switcher
    document.querySelectorAll(".font-family").forEach(
      function (item) {
        item.addEventListener(
          "click",
          async function (event) {
            let { cfi } = await this.getCFIFromXPath(this.bookState.progress);

            let fontFamily = event.target.innerText;
            this.setTheme({ fontFamily });

            this.setPosition(cfi);
          }.bind(this),
        );
      }.bind(this),
    );

    // Font Size
    document.querySelectorAll(".font-size").forEach(
      function (item) {
        item.addEventListener(
          "click",
          async function (event) {
            // Get Initial CFI
            let { cfi } = await this.getCFIFromXPath(this.bookState.progress);

            // Modify Size
            let currentSize = this.readerSettings.theme.fontSize || 1;
            let direction = event.target.innerText;
            if (direction == "-") {
              this.setTheme({ fontSize: currentSize * 0.99 });
            } else if (direction == "+") {
              this.setTheme({ fontSize: currentSize * 1.01 });
            }

            // Restore CFI
            this.setPosition(cfi);
          }.bind(this),
        );
      }.bind(this),
    );

    // Close Top Bar
    document.querySelector(".close-top-bar").addEventListener("click", () => {
      topBar.classList.remove("top-0");
    });
  }

  /**
   * Progresses to the next page & monitors reading activity
   **/
  async nextPage() {
    // Create Activity
    await this.createActivity();

    // Render Next Page
    await this.rendition.next();

    // Reset Read Timer
    this.bookState.pageStart = Date.now();

    // Update Stats
    let stats = await this.getBookStats();
    this.updateBookStatElements(stats);

    // Create Progress
    this.createProgress();
  }

  /**
   * Progresses to the previous page & monitors reading activity
   **/
  async prevPage() {
    // Render Previous Page
    await this.rendition.prev();

    // Reset Read Timer
    this.bookState.pageStart = Date.now();

    // Update Stats
    let stats = await this.getBookStats();
    this.updateBookStatElements(stats);

    // Create Progress
    this.createProgress();
  }

  /**
   * Display @ CFI x 3 (Hack)
   *
   *   This is absurd. Only way to get it to consistently show the correct
   *   page is to execute this three times. I tried the font hook,
   *   rendition hook, relocated hook, etc. No reliable way outside of
   *   running this three times.
   *
   *   Likely Bug: https://github.com/futurepress/epub.js/issues/1194
   **/
  async setPosition(cfi) {
    await this.rendition.display(cfi);
    await this.rendition.display(cfi);
    await this.rendition.display(cfi);

    this.highlightPositionMarker();
  }

  async createActivity() {
    // WPM MAX & MIN
    const WPM_MAX = 2000;
    const WPM_MIN = 100;

    // Get Elapsed Time
    let pageStart = this.bookState.pageStart;
    let elapsedTime = Date.now() - pageStart;

    // Update Current Word
    let pageWords = await this.getVisibleWordCount();
    let currentWord = await this.getBookWordPosition();
    let percentRead = pageWords / this.bookState.words;

    let pageWPM = pageWords / (elapsedTime / 60000);
    console.log("[createActivity] Page WPM:", pageWPM);

    // Exclude Ridiculous WPM
    if (pageWPM >= WPM_MAX)
      return console.log(
        "[createActivity] Page WPM Exceeds Max (2000):",
        pageWPM,
      );

    // Ensure WPM Minimum
    if (pageWPM < WPM_MIN) elapsedTime = (pageWords / WPM_MIN) * 60000;

    let totalPages = Math.round(1 / percentRead);

    // Exclude 0 Pages
    if (totalPages == 0)
      return console.warn("[createActivity] Invalid Total Pages (0)");

    let currentPage = Math.round(
      (currentWord * totalPages) / this.bookState.words,
    );

    // Create Activity Event
    let activityEvent = {
      device_id: this.readerSettings.deviceID,
      device: this.readerSettings.deviceName,
      activity: [
        {
          document: this.bookState.id,
          duration: Math.round(elapsedTime / 1000),
          start_time: Math.round(pageStart / 1000),
          page: currentPage,
          pages: totalPages,
        },
      ],
    };

    // Local Files
    if (this.bookState.type == "LOCAL") return;

    // Remote Flush -> Offline Cache IDB
    this.flushActivity(activityEvent).catch(async (e) => {
      console.error("[createActivity] Activity Flush Failed:", {
        error: e,
        data: activityEvent,
      });

      // Get & Update Activity
      let existingActivity = await IDB.get("ACTIVITY", { activity: [] });
      existingActivity.device_id = activityEvent.device_id;
      existingActivity.device = activityEvent.device;
      existingActivity.activity.push(...activityEvent.activity);

      // Update IDB
      await IDB.set("ACTIVITY", existingActivity);
    });
  }

  /**
   * Normalize and flush activity
   **/
  flushActivity(activityEvent) {
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
      }),
    );
  }

  async createProgress() {
    // Update Pointers
    let currentCFI = await this.rendition.currentLocation();
    let { element, xpath } = await this.getXPathFromCFI(currentCFI.start.cfi);
    let currentWord = await this.getBookWordPosition();
    console.log("[createProgress] Current Word:", currentWord);
    this.bookState.progress = xpath;
    this.bookState.progressElement = element;

    // Create Event
    let progressEvent = {
      document: this.bookState.id,
      device_id: this.readerSettings.deviceID,
      device: this.readerSettings.deviceName,
      percentage:
        Math.round((currentWord / this.bookState.words) * 100000) / 100000,
      progress: this.bookState.progress,
    };

    // Update Local Metadata
    if (this.bookState.type == "LOCAL") {
      let currentMetadata = await IDB.get("FILE-METADATA-" + this.bookState.id);
      return IDB.set("FILE-METADATA-" + this.bookState.id, {
        ...currentMetadata,
        progress: progressEvent.progress,
        percentage: Math.round(progressEvent.percentage * 10000) / 100,
        words: this.bookState.words,
      });
    }

    // Remote Flush -> Offline Cache IDB
    this.flushProgress(progressEvent).catch(async (e) => {
      console.error("[createProgress] Progress Flush Failed:", {
        error: e,
        data: progressEvent,
      });

      // Update IDB
      await IDB.set("PROGRESS-" + progressEvent.document, progressEvent);
    });
  }

  /**
   * Flush progress to the API. Called when the page changes.
   **/
  flushProgress(progressEvent) {
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
      }),
    );
  }

  /**
   * Derive chapter current page and total pages
   **/
  sectionProgress() {
    let visibleItems = this.rendition.manager.visible();
    if (visibleItems.length == 0)
      return console.log("[sectionProgress] No Items");
    let visibleSection = visibleItems[0];
    let visibleIndex = visibleSection.index;
    let pagesPerBlock = visibleSection.layout.divisor;
    let totalBlocks = visibleSection.width() / visibleSection.layout.width;
    let sectionPages = totalBlocks;

    let leftOffset = this.rendition.views().container.scrollLeft;
    let sectionCurrentPage =
      Math.round(leftOffset / visibleSection.layout.width) + 1;

    return { sectionPages, sectionCurrentPage };
  }

  /**
   * Get chapter pages, name and progress percentage
   **/
  async getBookStats() {
    let currentProgress = this.sectionProgress();
    if (!currentProgress) return;
    let { sectionPages, sectionCurrentPage } = currentProgress;

    let currentLocation = this.rendition.currentLocation();
    let currentWord = await this.getBookWordPosition();

    let currentTOC = this.book.navigation.toc.find(
      (item) => item.href == currentLocation.start.href,
    );

    return {
      sectionPage: sectionCurrentPage,
      sectionTotalPages: sectionPages,
      chapterName: currentTOC ? currentTOC.label.trim() : "N/A",
      percentage:
        Math.round((currentWord / this.bookState.words) * 10000) / 100,
    };
  }

  /**
   * Update elements with stats
   **/
  updateBookStatElements(data) {
    if (!data) return;

    let chapterStatus = document.querySelector("#chapter-status");
    let progressStatus = document.querySelector("#progress-status");
    let chapterName = document.querySelector("#chapter-name-status");
    let progressBar = document.querySelector("#progress-bar-status");

    chapterStatus.innerText = `${data.sectionPage} / ${data.sectionTotalPages}`;
    progressStatus.innerText = `${data.percentage}%`;
    progressBar.style.width = data.percentage + "%";
    chapterName.innerText = `${data.chapterName}`;
  }

  /**
   * Get XPath from current location
   **/
  async getXPathFromCFI(cfi) {
    // Get DocFragment (Spine Index)
    let startCFI = cfi.replace("epubcfi(", "");
    let docFragmentIndex =
      this.book.spine.spineItems.find((item) =>
        startCFI.startsWith(item.cfiBase),
      ).index + 1;

    // Base Progress
    let basePos = "/body/DocFragment[" + docFragmentIndex + "]/body";

    // Get First Node & Element Reference
    let contents = this.rendition.getContents()[0];
    let currentNode = contents.range(cfi).startContainer;
    let element =
      currentNode.nodeType == Node.ELEMENT_NODE
        ? currentNode
        : currentNode.parentElement;

    // XPath Reference
    let allPos = "";

    // Walk Upwards
    while (currentNode.nodeName != "BODY") {
      // Get Parent
      let parentElement = currentNode.parentElement;

      // Unknown Node -> Update Reference
      if (currentNode.nodeType != Node.ELEMENT_NODE) {
        console.log("[getXPathFromCFI] Unknown Node Type:", currentNode);
        currentNode = parentElement;
        continue;
      }

      /**
       * Exclude A tags. This could potentially be all inline elements:
       * https://github.com/koreader/crengine/blob/master/cr3gui/data/epub.css#L149
       **/
      while (parentElement.nodeName == "A") {
        parentElement = parentElement.parentElement;
      }

      /**
       * Note: This is depth / document order first, which means that this
       * _could_ return incorrect results when dealing with nested "A" tags
       * (dependent on how KOReader deals with nested "A" tags)
       **/
      let allDescendents = parentElement.querySelectorAll(currentNode.nodeName);
      let relativeIndex = Array.from(allDescendents).indexOf(currentNode) + 1;

      // Get Node Position
      let nodePos =
        currentNode.nodeName.toLowerCase() + "[" + relativeIndex + "]";

      // Update Reference
      currentNode = parentElement;

      // Update Position
      allPos = "/" + nodePos + allPos;
    }

    // Combine XPath
    let xpath = basePos + allPos;

    // Return Derived Progress
    return { xpath, element };
  }

  /**
   * Get CFI from current location
   **/
  async getCFIFromXPath(xpath) {
    // No XPath
    if (!xpath || xpath == "") return {};

    // Match Document Fragment Index
    let fragMatch = xpath.match(/^\/body\/DocFragment\[(\d+)\]/);
    if (!fragMatch) {
      console.warn("[getCFIFromXPath] No XPath Match");
      return {};
    }

    // Match Item Index
    let indexMatch = xpath.match(/\.(\d+)$/);
    let itemIndex = indexMatch ? parseInt(indexMatch[1]) : 0;

    // Get Spine Item
    let spinePosition = parseInt(fragMatch[1]) - 1;
    let sectionItem = this.book.spine.get(spinePosition);
    await sectionItem.load(this.book.load.bind(this.book));

    /**
     * Prefer Document Rendered over Document Not Rendered
     *
     * If the rendition is not displayed, the document does not exist in the
     * DOM. Since we return the matching element for potential theming, we
     * want to first at least try to get the document that exists in the DOM.
     *
     * This is only relevant on initial load and on font resize when we theme
     * the element to indicate to the user the last position, and is why we run
     * this function twice in the setupReader function; once before render to
     * get CFI, and once after render to get the actual element in the DOM to
     * theme.
     **/
    let docItem =
      this.rendition
        .getContents()
        .find((item) => item.sectionIndex == spinePosition)?.document ||
      sectionItem.document;

    // Derive Namespace & XPath
    let namespaceURI = docItem.documentElement.namespaceURI;
    let remainingXPath = xpath
      // Replace with new base
      .replace(fragMatch[0], "/html")
      // Replace `.0` Ending Indexes
      .replace(/\.(\d+)$/, "")
      // Remove potential trailing `text()`
      .replace(/\/text\(\)(\[\d+\])?$/, "");

    // XPath to Element
    let derivedSelectorElement = remainingXPath
      .replace(/^\/html\/body/, "body")
      .split("/")
      .reduce((el, item) => {
        // No Match
        if (!el) return null;

        // Non Index
        let indexMatch = item.match(/(\w+)\[(\d+)\]$/);
        if (!indexMatch) return el.querySelector(item);

        // Get @ Index
        let tag = indexMatch[1];
        let index = parseInt(indexMatch[2]) - 1;
        return el.querySelectorAll(tag)[index];
      }, docItem);

    console.log("[getCFIFromXPath] Selector Element:", derivedSelectorElement);

    // Validate Namespace
    if (namespaceURI) remainingXPath = remainingXPath.replaceAll("/", "/ns:");

    // Perform XPath
    let docSearch = docItem.evaluate(
      remainingXPath,
      docItem,
      function (prefix) {
        if (prefix === "ns") {
          return namespaceURI;
        } else {
          return null;
        }
      },
    );

    /**
     * There are two ways to do this. One via XPath, and the other via derived
     * CSS selectors. Unfortunately it seems like KOReaders XPath implementation
     * is a little wonky, requiring the need for CSS Selectors.
     *
     * For example the following XPath was generated by KOReader:
     *     "/body/DocFragment[19]/body/h1/img.0"
     *
     * In reality, the XPath should have been (note the 'a'):
     *     "/body/DocFragment[19]/body/h1/a/img.0"
     *
     * Unfortunately due to the above, `docItem.evaluate` will not find the
     * element. So as an alternative I thought it would be possible to derive
     * a CSS selector. I think this should be fully comprehensive; AFAICT
     * KOReader only creates XPaths referencing HTML tag names and indexes.
     **/

    // Get Element & CFI (XPath -> CSS Selector Fallback)
    let element = docSearch.iterateNext() || derivedSelectorElement;
    let cfi = sectionItem.cfiFromElement(element);

    return { cfi, element };
  }

  /**
   * Get visible word count - used for reading stats
   **/
  async getVisibleWordCount() {
    let visibleText = await this.getVisibleText();
    return visibleText.trim().split(/\s+/).length;
  }

  /**
   * Gets the word number of the whole book for the first visible word.
   **/
  async getBookWordPosition() {
    // Get Contents & Spine
    let contents = this.rendition.getContents()[0];
    let spineItem = this.book.spine.get(contents.sectionIndex);

    // Get CFI Range
    let firstCFI = spineItem.cfiFromElement(
      spineItem.document.body.children[0],
    );
    let currentLocation = await this.rendition.currentLocation();
    let cfiRange = this.getCFIRange(firstCFI, currentLocation.start.cfi);

    // Get Chapter Text (Before Current Position)
    let textRange = await this.book.getRange(cfiRange);
    let chapterText = textRange.toString();

    // Get Chapter & Book Positions
    let chapterWordPosition = chapterText.trim().split(/\s+/).length;
    let preChapterWordPosition = this.book.spine.spineItems
      .slice(0, contents.sectionIndex)
      .reduce((totalCount, item) => totalCount + item.wordCount, 0);

    // Return Current Word Pointer
    return chapterWordPosition + preChapterWordPosition;
  }

  /**
   * Get visible text - used for word counts
   **/
  async getVisibleText() {
    // Force Expand & Resize (Race Condition Issue)
    this.rendition.manager.visible().forEach((item) => item.expand());

    // Get Start & End CFI
    let currentLocation = await this.rendition.currentLocation();
    const [startCFI, endCFI] = [
      currentLocation.start.cfi,
      currentLocation.end.cfi,
    ];

    // Derive Range & Get Text
    let cfiRange = this.getCFIRange(startCFI, endCFI);
    let textRange = await this.book.getRange(cfiRange);
    let visibleText = textRange.toString();

    // Split on Whitespace
    return visibleText;
  }

  /**
   * Given two CFI's, return range
   **/
  getCFIRange(a, b) {
    const CFI = new ePub.CFI();
    const start = CFI.parse(a),
      end = CFI.parse(b);
    const cfi = {
      range: true,
      base: start.base,
      path: {
        steps: [],
        terminal: null,
      },
      start: start.path,
      end: end.path,
    };
    const len = cfi.start.steps.length;
    for (let i = 0; i < len; i++) {
      if (CFI.equalStep(cfi.start.steps[i], cfi.end.steps[i])) {
        if (i == len - 1) {
          // Last step is equal, check terminals
          if (cfi.start.terminal === cfi.end.terminal) {
            // CFI's are equal
            cfi.path.steps.push(cfi.start.steps[i]);
            // Not a range
            cfi.range = false;
          }
        } else cfi.path.steps.push(cfi.start.steps[i]);
      } else break;
    }
    cfi.start.steps = cfi.start.steps.slice(cfi.path.steps.length);
    cfi.end.steps = cfi.end.steps.slice(cfi.path.steps.length);

    return (
      "epubcfi(" +
      CFI.segmentString(cfi.base) +
      "!" +
      CFI.segmentString(cfi.path) +
      "," +
      CFI.segmentString(cfi.start) +
      "," +
      CFI.segmentString(cfi.end) +
      ")"
    );
  }

  /**
   * Count the words of the book. Useful for keeping a more accurate track
   * of progress percentage. Implementation returns the same number as the
   * server side implementation.
   **/
  async countWords() {
    let spineWC = await Promise.all(
      this.book.spine.spineItems.map(async (item) => {
        let newDoc = await item.load(this.book.load.bind(this.book));
        let spineWords = newDoc.innerText.trim().split(/\s+/).length;
        item.wordCount = spineWords;
        return spineWords;
      }),
    );

    return spineWC.reduce((totalCount, itemCount) => totalCount + itemCount, 0);
  }

  /**
   * Save settings to localStorage
   **/
  saveSettings() {
    if (!this.readerSettings) this.loadSettings();
    localStorage.setItem("readerSettings", JSON.stringify(this.readerSettings));
  }

  /**
   * Load reader settings from localStorage
   **/
  loadSettings() {
    this.readerSettings = JSON.parse(
      localStorage.getItem("readerSettings") || "{}",
    );
  }
}

document.addEventListener("DOMContentLoaded", initReader);

// WIP
async function getTOC() {
  let toc = currentReader.book.navigation.toc;

  // Alternatively:
  // let nav = await currentReader.book.loaded.navigation;
  // let toc = nav.toc;

  currentReader.rendition.display(nav.toc[10].href);
}
