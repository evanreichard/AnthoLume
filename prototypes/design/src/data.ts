export type Book = {
  id: string;
  title: string;
  author: string;
  kind: 'shared' | 'local';
  cover: string;
  category: string;
  description: string;
  progress: number;
  size: string;
};

export const books: Book[] = [
  {
    id: 'tidal',
    title: 'The Tidal Atlas',
    author: 'Mara Ellery',
    kind: 'shared',
    cover: 'tidal',
    category: 'A novel',
    description:
      'On an island where every road ends at the sea, a mapmaker returns to chart the places that have changed — and the things that have not. A quiet, imagined story about finding your bearings.',
    progress: 24,
    size: '2.4 MB',
  },
  {
    id: 'ordinary',
    title: 'Ordinary Light',
    author: 'Theo Arden',
    kind: 'shared',
    cover: 'ordinary',
    category: 'Essays',
    description:
      'Small observations from familiar rooms. These invented essays follow the movement of light through an ordinary day.',
    progress: 61,
    size: '1.8 MB',
  },
  {
    id: 'garden',
    title: 'A Garden in Winter',
    author: 'June Vale',
    kind: 'shared',
    cover: 'garden',
    category: 'Nature writing',
    description:
      'Notes from a garden at rest: bare branches, patient roots, and the small promises of another season.',
    progress: 0,
    size: '3.1 MB',
  },
  {
    id: 'distance',
    title: 'Measures of Distance',
    author: 'Ivo North',
    kind: 'shared',
    cover: 'distance',
    category: 'Short stories',
    description:
      'An imagined set of journeys across cities, landscapes, and the distances between people.',
    progress: 0,
    size: '1.2 MB',
  },
  {
    id: 'field',
    title: 'Field Notes',
    author: 'Alex Rowan',
    kind: 'local',
    cover: 'field',
    category: 'Local manuscript',
    description:
      'A synthetic local-only book. No upload, server record, or shared reading activity. This browser is its only home in the demo.',
    progress: 12,
    size: '0.6 MB',
  },
];

export const chapterTitles = [
  'The harbour at first light',
  'A map of small things',
  'The path inland',
  'What the water leaves',
];
export const sampleParagraphs = [
  'By the time the harbour woke, Elin had already unfolded the old map. She held its corners flat against the kitchen table and followed the coastline with one finger. The paper had softened at the creases, turning familiar distances into a landscape of its own.',
  'Outside, the tide was slipping away from the steps. A small blue boat settled into the sand, and somewhere beyond the wall a gate opened, then closed. These were the sounds she remembered: not quite silence, but the measured work of a place beginning its day.',
  'She had come back to draw the island again. Not because the shore had moved very far, though in places it had, but because a map was also a record of attention. A path appeared when someone walked it. A name remained because someone spoke it aloud.',
  'At the edge of the page, where the ink gave way to a wide unmarked sea, her father had written a single instruction. Leave room, it said. She had spent years wondering whether he meant the paper, or something else.',
  'Elin put a clean sheet beside the old one. The morning light crossed both pages equally. For a while she sat without making a mark, listening to the water finding its way through the stones.',
];
