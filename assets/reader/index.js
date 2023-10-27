const THEMES = ["light", "tan", "blue", "gray", "black"];
const THEME_FILE = "/assets/reader/readerThemes.css";

class EBookReader {
  bookState = {
    currentWord: 0,
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
    });

    // Setup Reader
    this.book.ready.then(this.setupReader.bind(this));

    // Initialize
    this.initDevice();
    this.initWakeLock();
    this.initThemes();
    this.initRenditionListeners();
    this.initDocumentListeners();
  }

  /**
   * Load progress and generate locations
   **/
  async setupReader() {
    // Get Word Count (If Needed)
    if (this.bookState.words == 0)
      this.bookState.words = await this.countWords();

    // Load Progress
    let { cfi } = await this.getCFIFromXPath(this.bookState.progress);
    this.bookState.currentWord = cfi
      ? this.bookState.percentage * (this.bookState.words / 100)
      : 0;

    let getStats = function () {
      // Start Timer
      this.bookState.pageStart = Date.now();

      // Get Stats
      let stats = this.getBookStats();
      this.updateBookStats(stats);
    }.bind(this);

    // Register Content Hook
    this.rendition.hooks.content.register(getStats);

    // Update Position
    await this.setPosition(cfi);

    // Highlight Element - DOM Has Element
    let { element } = await this.getCFIFromXPath(this.bookState.progress);

    this.bookState.progressElement = element;
    this.highlightPositionMarker();
  }

  initDevice() {
    function randomID() {
      return "00000000000000000000000000000000".replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4))))
          .toString(16)
          .toUpperCase()
      );
    }

    this.readerSettings.deviceName =
      this.readerSettings.deviceName ||
      platform.os.toString() + " - " + platform.name;

    this.readerSettings.deviceID = this.readerSettings.deviceID || randomID();

    // Save Settings (Device ID)
    this.saveSettings();
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
      this.rendition.themes.register(theme, THEME_FILE)
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

        // Set Fonts - TODO: Local
        //   https://gwfh.mranftl.com/fonts
        this.rendition.getContents().forEach((c) => {
          [
            "https://fonts.googleapis.com/css?family=Arbutus+Slab",
            "https://fonts.googleapis.com/css?family=Open+Sans",
            "https://fonts.googleapis.com/css?family=Lato:400,400i,700,700i",
          ].forEach((url) => {
            let el = c.document.head.appendChild(
              c.document.createElement("link")
            );
            el.setAttribute("rel", "stylesheet");
            el.setAttribute("href", url);
          });
        });
      }.bind(this)
    );
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
      (item) => item.selectorText == "." + colorScheme
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
        fontFamily
      );

      // Set Font Size
      item.document.documentElement.style.setProperty(
        "--editor-font-size",
        fontSize + "em"
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
      this.bookState.progressElement.ownerDocument.body
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
   * Rendition hooks
   **/
  initRenditionListeners() {
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
    let getCFIFromXPath = this.getCFIFromXPath.bind(this);
    let setPosition = this.setPosition.bind(this);
    let nextPage = this.nextPage.bind(this);
    let prevPage = this.prevPage.bind(this);
    let saveSettings = this.saveSettings.bind(this);

    // Local Vars
    let readerSettings = this.readerSettings;
    let bookState = this.bookState;

    this.rendition.hooks.render.register(function (doc, data) {
      let renderDoc = doc.document;

      // ------------------------------------------------ //
      // ---------------- Wake Lock Hack ---------------- //
      // ------------------------------------------------ //
      let wakeLockListener = function () {
        doc.window.parent.document.dispatchEvent(new CustomEvent("wakelock"));
      };
      renderDoc.addEventListener("click", wakeLockListener);
      renderDoc.addEventListener("gesturechange", wakeLockListener);
      renderDoc.addEventListener("touchstart", wakeLockListener);

      // ------------------------------------------------ //
      // --------------- Swipe Pagination --------------- //
      // ------------------------------------------------ //
      let touchStartX,
        touchStartY,
        touchEndX,
        touchEndY = undefined;

      renderDoc.addEventListener(
        "touchstart",
        function (event) {
          touchStartX = event.changedTouches[0].screenX;
          touchStartY = event.changedTouches[0].screenY;
        },
        false
      );

      renderDoc.addEventListener(
        "touchend",
        function (event) {
          touchEndX = event.changedTouches[0].screenX;
          touchEndY = event.changedTouches[0].screenY;
          handleGesture(event);
        },
        false
      );

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

      // ------------------------------------------------ //
      // --------------- Bottom & Top Bar --------------- //
      // ------------------------------------------------ //
      let emSize = parseFloat(getComputedStyle(renderDoc.body).fontSize);
      renderDoc.addEventListener("click", function (event) {
        let barPixels = emSize * 5;

        let top = barPixels;
        let bottom = window.innerHeight - top;

        let left = barPixels / 2;
        let right = window.innerWidth - left;

        if (event.clientY < top) handleSwipeDown();
        else if (event.clientY > bottom) handleSwipeUp();
        else if (event.screenX < left) prevPage();
        else if (event.screenX > right) nextPage();
        else {
          bottomBar.classList.remove("bottom-0");
          topBar.classList.remove("top-0");
        }
      });

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
        }, 400)
      );

      function handleSwipeDown() {
        if (bottomBar.classList.contains("bottom-0"))
          bottomBar.classList.remove("bottom-0");
        else topBar.classList.add("top-0");
      }

      function handleSwipeUp() {
        if (topBar.classList.contains("top-0"))
          topBar.classList.remove("top-0");
        else bottomBar.classList.add("bottom-0");
      }

      // ------------------------------------------------ //
      // -------------- Keyboard Shortcuts -------------- //
      // ------------------------------------------------ //
      renderDoc.addEventListener(
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
              readerSettings.theme.colorScheme
            );
            let colorScheme =
              THEMES.length == currentThemeIdx + 1
                ? THEMES[0]
                : THEMES[currentThemeIdx + 1];
            setTheme({ colorScheme });
          }
        },
        false
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

    // Keyboard Shortcuts
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
            this.readerSettings.theme.colorScheme
          );
          let colorScheme =
            THEMES.length == currentThemeIdx + 1
              ? THEMES[0]
              : THEMES[currentThemeIdx + 1];
          this.setTheme({ colorScheme });
        }
      }.bind(this),
      false
    );

    // Color Scheme Switcher
    document.querySelectorAll(".color-scheme").forEach(
      function (item) {
        item.addEventListener(
          "click",
          function (event) {
            let colorScheme = event.target.innerText;
            console.log(colorScheme);
            this.setTheme({ colorScheme });
          }.bind(this)
        );
      }.bind(this)
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
          }.bind(this)
        );
      }.bind(this)
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
          }.bind(this)
        );
      }.bind(this)
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
    // Flush Activity
    this.flushActivity();

    // Get Elapsed Time
    let elapsedTime = Date.now() - this.bookState.pageStart;

    // Update Current Word
    let pageWords = await this.getVisibleWordCount();
    let startingWord = this.bookState.currentWord;
    let percentRead = pageWords / this.bookState.words;
    this.bookState.currentWord += pageWords;

    // Add Read Event
    this.bookState.readActivity.push({
      percentRead,
      startingWord,
      pageWords,
      elapsedTime,
      startTime: this.bookState.pageStart,
    });

    // Render Next Page
    await this.rendition.next();

    // Reset Read Timer
    this.bookState.pageStart = Date.now();

    // Update Stats
    let stats = this.getBookStats();
    this.updateBookStats(stats);

    // Update & Flush Progress
    let currentCFI = await this.rendition.currentLocation();
    let { element, xpath } = await this.getXPathFromCFI(currentCFI.start.cfi);
    this.bookState.progress = xpath;
    this.bookState.progressElement = element;

    this.flushProgress();
  }

  /**
   * Progresses to the previous page & monitors reading activity
   **/
  async prevPage() {
    // Flush Activity
    this.flushActivity();

    // Render Previous Page
    await this.rendition.prev();

    // Update Current Word
    let pageWords = await this.getVisibleWordCount();
    this.bookState.currentWord -= pageWords;

    // Reset Read Timer
    this.bookState.pageStart = Date.now();

    // Update Stats
    let stats = this.getBookStats();
    this.updateBookStats(stats);

    // Update & Flush Progress
    let currentCFI = await this.rendition.currentLocation();
    let { element, xpath } = await this.getXPathFromCFI(currentCFI.start.cfi);
    this.bookState.progress = xpath;
    this.bookState.progressElement = element;
    this.flushProgress();
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

  /**
   * Normalize and flush activity
   **/
  async flushActivity() {
    // Process & Reset Activity
    let allActivity = this.bookState.readActivity;
    this.bookState.readActivity = [];

    const WPM_MAX = 2000;
    const WPM_MIN = 100;

    let normalizedActivity = allActivity
      // Exclude Fast WPM
      .filter((item) => item.pageWords / (item.elapsedTime / 60000) < WPM_MAX)
      .map((item) => {
        let pageWPM = item.pageWords / (item.elapsedTime / 60000);

        // Min WPM
        if (pageWPM < WPM_MIN) {
          // TODO - Exclude Event?
          item.elapsedTime = (item.pageWords / WPM_MIN) * 60000;
        }

        item.pages = Math.round(1 / item.percentRead);

        item.page = Math.round(
          (item.startingWord * item.pages) / this.bookState.words
        );

        // Estimate Accuracy Loss (Debugging)
        // let wordLoss = Math.abs(
        //   item.pageWords - this.bookState.words / item.pages
        // );
        // console.log("Word Loss:", wordLoss);

        return {
          document: this.bookState.id,
          duration: Math.round(item.elapsedTime / 1000),
          start_time: Math.round(item.startTime / 1000),
          page: item.page,
          pages: item.pages,
        };
      });

    if (normalizedActivity.length == 0) return;

    console.log("Flushing Activity...");

    // Create Activity Event
    let activityEvent = {
      device_id: this.readerSettings.deviceID,
      device: this.readerSettings.deviceName,
      activity: normalizedActivity,
    };

    // Flush Activity
    fetch("/api/ko/activity", {
      method: "POST",
      body: JSON.stringify(activityEvent),
    })
      .then(async (r) =>
        console.log("Flushed Activity:", {
          response: r,
          json: await r.json(),
          data: activityEvent,
        })
      )
      .catch((e) =>
        console.error("Activity Flush Failed:", {
          error: e,
          data: activityEvent,
        })
      );
  }

  /**
   * Flush progress to the API. Called when the page changes.
   **/
  async flushProgress() {
    console.log("Flushing Progress...");

    // Create Progress Event
    let progressEvent = {
      document: this.bookState.id,
      device_id: this.readerSettings.deviceID,
      device: this.readerSettings.deviceName,
      percentage:
        Math.round(
          (this.bookState.currentWord / this.bookState.words) * 100000
        ) / 100000,
      progress: this.bookState.progress,
    };

    // Flush Progress
    fetch("/api/ko/syncs/progress", {
      method: "PUT",
      body: JSON.stringify(progressEvent),
    })
      .then(async (r) =>
        console.log("Flushed Progress:", {
          response: r,
          json: await r.json(),
          data: progressEvent,
        })
      )
      .catch((e) =>
        console.error("Progress Flush Failed:", {
          error: e,
          data: progressEvent,
        })
      );
  }

  /**
   * Derive chapter current page and total pages
   **/
  sectionProgress() {
    let visibleItems = this.rendition.manager.visible();
    if (visibleItems.length == 0) return console.log("No Items");
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
  getBookStats() {
    let currentProgress = this.sectionProgress();
    if (!currentProgress) return;
    let { sectionPages, sectionCurrentPage } = currentProgress;

    let currentLocation = this.rendition.currentLocation();

    let currentTOC = this.book.navigation.toc.find(
      (item) => item.href == currentLocation.start.href
    );

    return {
      sectionPage: sectionCurrentPage,
      sectionTotalPages: sectionPages,
      chapterName: currentTOC ? currentTOC.label.trim() : "N/A",
      percentage:
        Math.round(
          (this.bookState.currentWord / this.bookState.words) * 10000
        ) / 100,
    };
  }

  /**
   * Update elements with stats
   **/
  updateBookStats(data) {
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
    // Get DocFragment (current book spline index)
    let startCFI = cfi.replace("epubcfi(", "");
    let docFragmentIndex =
      this.book.spine.spineItems.find((item) =>
        startCFI.startsWith(item.cfiBase)
      ).index + 1;

    // Base Progress
    let newPos = "/body/DocFragment[" + docFragmentIndex + "]/body";

    // Get first visible node
    let contents = this.rendition.getContents()[0];
    let node = contents.range(cfi).startContainer;
    let element = null;

    // Walk upwards and build progress until body
    let childPos = "";
    while (node.nodeName != "BODY") {
      let ownValue;

      switch (node.nodeType) {
        case Node.ELEMENT_NODE:
          // Store First Element Node
          if (!element) element = node;
          let relativeIndex =
            Array.from(node.parentNode.children)
              .filter((item) => item.nodeName == node.nodeName)
              .indexOf(node) + 1;

          ownValue = node.nodeName.toLowerCase() + "[" + relativeIndex + "]";
          break;
        case Node.ATTRIBUTE_NODE:
          ownValue = "@" + node.nodeName;
          break;
        case Node.TEXT_NODE:
        case Node.CDATA_SECTION_NODE:
          ownValue = "text()";
          break;
        case Node.PROCESSING_INSTRUCTION_NODE:
          ownValue = "processing-instruction()";
          break;
        case Node.COMMENT_NODE:
          ownValue = "comment()";
          break;
        case Node.DOCUMENT_NODE:
          ownValue = "";
          break;
        default:
          ownValue = "";
          break;
      }

      // Prepend childPos & Update node reference
      childPos = "/" + ownValue + childPos;
      node = node.parentNode;
    }

    let xpath = newPos + childPos;

    // Return derived progress
    return { xpath, element };
  }

  /**
   * Get CFI from current location
   **/
  async getCFIFromXPath(xpath) {
    // XPath Reference - Example: /body/DocFragment[15]/body/div[10]/text().184
    //
    //     - /body/DocFragment[15] = 15th item in book spline
    //     - [...]/body/div[10] = 10th child div under body (direct descendents only)
    //     - [...]/text().184 = text node of parent, character offset @ 184 chars?

    // No XPath
    if (!xpath || xpath == "") return {};

    // Match Document Fragment Index
    let fragMatch = xpath.match(/^\/body\/DocFragment\[(\d+)\]/);
    if (!fragMatch) {
      console.warn("No XPath Match");
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

    // Derive XPath & Namespace
    let namespaceURI = docItem.documentElement.namespaceURI;
    let remainingXPath = xpath
      // Replace with new base
      .replace(fragMatch[0], "/html")
      // Replace `.0` Ending Indexes
      .replace(/\.(\d+)$/, "")
      // Remove potential trailing `text()`
      .replace(/\/text\(\)(\[\d+\])?$/, "");

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
      }
    );

    // Get Element & CFI
    let element = docSearch.iterateNext();
    let cfi = sectionItem.cfiFromElement(element);

    return { cfi, element };
  }

  /**
   * Get visible word count - used for reading stats
   **/
  async getVisibleWordCount() {
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
    return visibleText.trim().split(/\s+/).length;
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
  countWords() {
    // Iterate over each item in the spine, render, and count words.
    return this.book.spine.spineItems.reduce(async (totalCount, item) => {
      let currentCount = await totalCount;
      let newDoc = await item.load(this.book.load.bind(this.book));
      let itemCount = newDoc.innerText.trim().split(/\s+/).length;
      return currentCount + itemCount;
    }, 0);
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
      localStorage.getItem("readerSettings") || "{}"
    );
  }
}
