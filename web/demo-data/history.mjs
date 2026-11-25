// Pinned Editions - Book indices match books.mjs; word counts include front and back matter like the reader.
const book = { alice: 0, holmes: 1, frankenstein: 2, timeMachine: 3, dorian: 4, jekyll: 5 };
const bookWords = [29_556, 107_575, 78_106, 35_489, 82_029, 28_692];
const wordsPerPage = 125;
const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

// Session Endpoints - Fractions estimate the word offset at each heading or paragraph in the pinned spine.
// Each row is [days ago, UTC end hour (unused today), book, spine, end fraction, optional paragraph].
const readingPlans = [
  [
    [27, 21, book.holmes, 3, 0.0291, 75],
    [25, 19, book.alice, 3, 0.0434, 12],
    [24, 20, book.frankenstein, 7, 0.0388],
    [22, 14, book.alice, 4, 0.081],
    [20, 21, book.timeMachine, 4, 0.0532],
    [18, 19, book.holmes, 3, 0.0504, 150],
    [16, 20, book.frankenstein, 8, 0.0738],
    [15, 13, book.alice, 4, 0.1175, 13],
    [13, 22, book.timeMachine, 5, 0.0909],
    [11, 19, book.alice, 5, 0.152],
    [10, 20, book.frankenstein, 9, 0.0964],
    [8, 14, book.holmes, 3, 0.072, 220],
    [7, 19, book.timeMachine, 6, 0.1469],
    [5, 21, book.alice, 6, 0.2096],
    [4, 19, book.frankenstein, 10, 0.1247],
    [2, 12, book.alice, 6, 0.2459, 15],
    [1, 20, book.holmes, 4, 0.1001, 52],
    [0, 0, book.alice, 7, 0.2981],
  ],
  [
    [30, 8, book.jekyll, 3, 0.0689, 12],
    [28, 12, book.dorian, 4, 0.0232, 18],
    [26, 8, book.timeMachine, 4, 0.0532],
    [23, 9, book.jekyll, 4, 0.0908],
    [21, 12, book.dorian, 4, 0.041, 48],
    [18, 8, book.jekyll, 4, 0.1532, 25],
    [17, 13, book.frankenstein, 7, 0.0388],
    [15, 8, book.dorian, 5, 0.067],
    [12, 10, book.timeMachine, 5, 0.0909],
    [11, 9, book.jekyll, 5, 0.1931],
    [9, 8, book.dorian, 5, 0.0974, 48],
    [7, 11, book.frankenstein, 8, 0.0738],
    [6, 9, book.jekyll, 7, 0.2791],
    [4, 12, book.timeMachine, 6, 0.1469],
    [2, 8, book.jekyll, 8, 0.3361],
    [1, 9, book.dorian, 5, 0.1241, 90],
    [0, 0, book.jekyll, 9, 0.3882],
  ],
];

export function readingSessions(readerIndex, now) {
  const midnight = Math.floor(+now / dayMs) * dayMs;
  const progress = new Map();
  return readingPlans[readerIndex].map(([daysAgo, endHour, bookIndex, spine, endFraction, paragraph], sessionIndex) => {
    const startFraction = progress.get(bookIndex) ?? 0;
    const delta = endFraction - startFraction;
    const pages = Math.max(1, Math.round((delta * bookWords[bookIndex]) / wordsPerPage));
    const pageFraction = delta / pages;
    const durations = Array.from(
      { length: pages },
      (_, page) => 30 + ((page * 17 + page ** 2 * 3 + sessionIndex * 13 + readerIndex * 19) % 31),
    );
    progress.set(bookIndex, startFraction + pages * pageFraction);

    // Midnight - Ending the newest session at the reference instant lets it straddle midnight without future page turns.
    const end = daysAgo ? midnight - daysAgo * dayMs + endHour * hourMs : +now;
    const start = new Date(end - 1000 * durations.reduce((sum, seconds) => sum + seconds, 0));
    const position = `/body/DocFragment[${spine}]/body/div/${paragraph ? `p[${paragraph}]` : 'h2'}`;
    return { bookIndex, start, durations, startFraction, pageFraction, position };
  });
}
