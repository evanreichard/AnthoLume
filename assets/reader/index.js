const THEMES = ["light", "tan", "blue", "gray", "black"];
const THEME_FILE = "/assets/reader/readerThemes.css";

class EBookReader {
  bookState = {
    currentWord: 0,
    pages: 0,
    percentage: 0,
    progress: "",
    readActivity: [],
    words: 0,
  };

  constructor(file, bookState) {
    // Set Variables
    Object.assign(this.bookState, bookState);

    // Load EPUB
    this.book = ePub(file, { openAs: "epub" });
    window.book = this.book;

    // Render
    this.rendition = this.book.renderTo("viewer", {
      manager: "default",
      flow: "paginated",
      width: "100%",
      height: "100%",
    });

    // Setup Reader
    this.book.ready.then(this.setupReader.bind(this));

    // Load Settings
    this.loadSettings();

    // Initialize
    this.initDevice();
    this.initThemes();
    this.initRenditionListeners();
    this.initDocumentListeners();
  }

  /**
   * Load progress and generate locations
   **/
  async setupReader() {
    // Load Progress
    let currentCFI = await this.fromProgress(this.bookState.progress);
    if (!currentCFI) this.bookState.currentWord = 0;
    await this.rendition.display(currentCFI);

    // Restore Theme
    this.setTheme(this.readerSettings.theme || "tan");

    let getStats = function () {
      // Start Timer
      this.bookState.pageStart = Date.now();

      // Get Stats
      let stats = this.getBookStats();
      this.updateBookStats(stats);
    }.bind(this);

    // Register Content Hook
    this.rendition.hooks.content.register(getStats);
    getStats();
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

    this.saveSettings();
  }

  /**
   * Register all themes with reader
   **/
  initThemes() {
    // Register Themes
    THEMES.forEach((theme) =>
      this.rendition.themes.register(theme, THEME_FILE)
    );
  }

  /**
   * Set theme & meta theme color
   **/
  setTheme(themeName) {
    this.rendition.themes.select(themeName);
    let themeColorEl = document.querySelector("[name='theme-color']");
    let backgroundColor = window.getComputedStyle(
      this.rendition.getContents()[0].content
    ).backgroundColor;
    themeColorEl.setAttribute("content", backgroundColor);
    document.body.style.backgroundColor = backgroundColor;
    this.saveSettings();
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

    let nextPage = this.nextPage.bind(this);
    let prevPage = this.prevPage.bind(this);
    let saveSettings = this.saveSettings.bind(this);

    // Font Scaling
    let readerSettings = this.readerSettings;
    this.rendition.hooks.render.register(function (doc, data) {
      let renderDoc = doc.document;

      // Initial Font Size
      renderDoc.documentElement.style.setProperty(
        "--editor-font-size",
        (readerSettings.fontSize || 1) + "em"
      );
      this.themes.default({
        "*": { "font-size": "var(--editor-font-size) !important" },
      });

      // ------------------------------------------------ //
      // ---------------- Resize Helpers ---------------- //
      // ------------------------------------------------ //
      let isScaling = false;
      let lastScale = 1;
      let lastLocation = undefined;
      let debounceID = undefined;
      let debounceGesture = () => {
        this.display(lastLocation.start.cfi);
        lastLocation = undefined;
        isScaling = false;
      };

      // Gesture Listener
      renderDoc.addEventListener(
        "gesturechange",
        async function (e) {
          e.preventDefault();

          isScaling = true;
          clearTimeout(debounceID);

          if (!lastLocation) {
            lastLocation = await this.currentLocation();
          } else {
            // Damped Scale
            readerSettings.fontSize =
              (readerSettings.fontSize || 1) + (e.scale - lastScale) / 5;
            lastScale = e.scale;
            saveSettings();

            // Update Font Size
            renderDoc.documentElement.style.setProperty(
              "--editor-font-size",
              (readerSettings.fontSize || 1) + "em"
            );

            debounceID = setTimeout(debounceGesture, 200);
          }
        }.bind(this),
        true
      );

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
          if (!isScaling) handleGesture(event);
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
            let currentThemeIdx = THEMES.indexOf(readerSettings.theme);
            if (THEMES.length == currentThemeIdx + 1)
              readerSettings.theme = THEMES[0];
            else readerSettings.theme = THEMES[currentThemeIdx + 1];
            setTheme(readerSettings.theme);
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
          let currentThemeIdx = THEMES.indexOf(this.readerSettings.theme);
          if (THEMES.length == currentThemeIdx + 1)
            this.readerSettings.theme = THEMES[0];
          else this.readerSettings.theme = THEMES[currentThemeIdx + 1];
          this.setTheme(this.readerSettings.theme);
        }
      }.bind(this),
      false
    );

    document.querySelectorAll(".theme").forEach(
      function (item) {
        item.addEventListener(
          "click",
          function (event) {
            this.readerSettings.theme = event.target.innerText;

            this.setTheme(this.readerSettings.theme);
          }.bind(this)
        );
      }.bind(this)
    );

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
    this.bookState.progress = await this.toProgress();
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
    this.bookState.progress = await this.toProgress();
    this.flushProgress();
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
  async toProgress() {
    // Get DocFragment (current book spline index)
    let currentPos = await this.rendition.currentLocation();
    let docFragmentIndex = currentPos.start.index + 1;

    // Base Progress
    let newPos = "/body/DocFragment[" + docFragmentIndex + "]/body";

    // Get first visible node
    let contents = this.rendition.getContents()[0];
    let currentNode = contents.range(currentPos.start.cfi).startContainer
      .parentNode;

    // Walk upwards and build progress until body
    let childPos = "";
    while (currentNode.nodeName != "BODY") {
      let relativeIndex =
        Array.from(currentNode.parentNode.children)
          .filter((item) => item.nodeName == currentNode.nodeName)
          .indexOf(currentNode) + 1;

      // E.g: /div[10]
      let itemPos =
        "/" + currentNode.nodeName.toLowerCase() + "[" + relativeIndex + "]";

      // Prepend childPos & Update currentNode refernce
      childPos = itemPos + childPos;
      currentNode = currentNode.parentNode;
    }

    // Return derived progress
    return newPos + childPos;
  }

  /**
   * Get CFI from XPath
   **/
  async fromProgress(progress) {
    // Progress Reference - Example: /body/DocFragment[15]/body/div[10]/text().184
    //
    //     - /body/DocFragment[15] = 15th item in book spline
    //     - [...]/body/div[10] = 10th child div under body (direct descendents only)
    //     - [...]/text().184 = text node of parent, character offset @ 184 chars?

    // No Progress
    if (!progress || progress == "") return;

    // Match Document Fragment Index
    let fragMatch = progress.match(/^\/body\/DocFragment\[(\d+)\]/);
    if (!fragMatch) {
      console.warn("No Progress Match");
      return;
    }

    // Match Item Index
    let indexMatch = progress.match(/\.(\d+)$/);
    let itemIndex = indexMatch ? parseInt(indexMatch[1]) : 0;

    // Get Spine Item
    let spinePosition = parseInt(fragMatch[1]) - 1;
    let docItem = this.book.spine.get(spinePosition);

    // Required for docItem.document Access
    await docItem.load(this.book.load.bind(this.book));

    // Derive XPath & Namespace
    let namespaceURI = docItem.document.documentElement.namespaceURI;
    let remainingXPath = progress
      // Replace with new base
      .replace(fragMatch[0], "/html")
      // Replace `.0` Ending Indexes
      .replace(/\.(\d+)$/, "")
      // Remove potential trailing `text()`
      .replace(/\/text\(\)$/, "");

    // Validate Namespace
    if (namespaceURI) remainingXPath = remainingXPath.replaceAll("/", "/ns:");

    // Perform XPath
    let docSearch = docItem.document.evaluate(
      remainingXPath,
      docItem.document,
      function (prefix) {
        if (prefix === "ns") {
          return namespaceURI;
        } else {
          return null;
        }
      }
    );

    // Get Element & CFI
    let matchedItem = docSearch.iterateNext();
    let matchedCFI = docItem.cfiFromElement(matchedItem);
    return matchedCFI;
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
   * Save settings to localStorage
   **/
  saveSettings(obj) {
    if (!this.readerSettings) this.loadSettings();
    let newSettings = Object.assign(this.readerSettings, obj);
    localStorage.setItem("readerSettings", JSON.stringify(newSettings));
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