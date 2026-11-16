import assert from "node:assert/strict";
import { balanceBySource } from "./desk.js";
import { addNote, readBook } from "./coaching.js";

const wires = [
  { sourceName: "Decrypt", publishedAt: "2026-11-16T20:00:00.000Z", title: "a" },
  { sourceName: "Decrypt", publishedAt: "2026-11-16T19:00:00.000Z", title: "b" },
  { sourceName: "Decrypt", publishedAt: "2026-11-16T18:00:00.000Z", title: "c" },
  { sourceName: "Decrypt", publishedAt: "2026-11-16T17:00:00.000Z", title: "d" },
  { sourceName: "SEC", publishedAt: "2026-11-16T12:00:00.000Z", title: "sec" },
];

const balanced = balanceBySource(wires, 3, 10);
assert.deepEqual(
  balanced.map((item) => item.title),
  ["a", "b", "c", "sec"],
);

const first = addNote({ notes: [] }, "  More Bitcoin.   Less small hacks. ", "2026-11-16T21:00:00.000Z");
assert.equal(first.stored, true);
assert.equal(first.book.notes[0]?.text, "More Bitcoin. Less small hacks.");
const again = addNote(first.book, "More Bitcoin. Less small hacks.", "2026-11-16T22:00:00.000Z");
assert.equal(again.stored, false);
assert.equal(again.book.notes.length, 1);
assert.deepEqual(readBook({ notes: first.book.notes }).notes[0]?.text, "More Bitcoin. Less small hacks.");
