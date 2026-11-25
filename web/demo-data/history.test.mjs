import assert from 'node:assert/strict';
import test from 'node:test';
import { readingSessions } from './history.mjs';

const dayMs = 86_400_000;

function endOf({ start, durations }) {
  return +start + durations.reduce((elapsed, seconds) => elapsed + seconds * 1000, 0);
}

for (const readerIndex of [0, 1]) {
  test(`reader ${readerIndex} has multi-week page-turn history with continuous per-book progress`, () => {
    const now = new Date('2026-07-10T17:42:00Z');
    const sessions = readingSessions(readerIndex, now);
    assert.ok(+now - sessions[0].start >= 21 * dayMs);
    assert.ok(sessions.length >= 12);
    const progress = new Map();
    const pageDurations = new Set();
    let previousEnd = -Infinity;

    for (const { bookIndex, start, durations, startFraction, pageFraction, position } of sessions) {
      assert.ok(start instanceof Date);
      assert.ok(+start >= previousEnd);
      previousEnd = endOf({ start, durations });
      assert.ok(previousEnd <= +now);
      assert.ok(durations.length > 0);
      for (const seconds of durations) {
        assert.ok(Number.isInteger(seconds) && seconds >= 30 && seconds <= 60);
        pageDurations.add(seconds);
      }
      assert.equal(startFraction, progress.get(bookIndex) ?? 0);
      assert.ok(pageFraction > 0 && pageFraction < 0.005);
      const endFraction = startFraction + durations.length * pageFraction;
      assert.ok(endFraction <= 1);
      progress.set(bookIndex, endFraction);
      assert.match(position, /^\/body\/DocFragment\[\d+\]\/body\/div\/(h2|p\[\d+\])$/);
    }
    assert.ok(progress.size >= 3);
    assert.ok(pageDurations.size >= 10);
  });

  test(`reader ${readerIndex}'s timeline moves with the seed date and stays valid around midnight`, () => {
    const now = new Date('2026-07-10T00:00:01Z');
    const nextDay = new Date(+now + dayMs);
    const first = readingSessions(readerIndex, now);
    const shifted = readingSessions(readerIndex, nextDay);
    assert.deepEqual(
      shifted,
      first.map((session) => ({ ...session, start: new Date(+session.start + dayMs) })),
    );
    const latest = first.at(-1);
    assert.ok(latest.start < now);
    assert.equal(endOf(latest), +now);
    assert.ok(endOf(first.at(-2)) <= +latest.start);
  });
}

test('Robin last stopped at Advice from a Caterpillar while the second reader has a separate history', () => {
  const now = new Date('2026-07-10T20:00:00Z');
  const robin = readingSessions(0, now).at(-1);
  const secondReader = readingSessions(1, now).at(-1);
  assert.equal(robin.bookIndex, 0);
  assert.equal(robin.position, '/body/DocFragment[7]/body/div/h2');
  assert.notEqual(secondReader.bookIndex, robin.bookIndex);
});
