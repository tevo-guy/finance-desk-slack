export const COACHING_KEY = "desk:coaching";

export const STANDING_BRIEF =
  "Send a story a broad X and Instagram audience would repost today. Prefer Bitcoin, Ethereum, major ETFs, the Fed, the SEC, or a household-name company. Prefer a hack or a loss only when people outside that project would care. Skip niche protocol incidents, small-cap token moves, mining-tool bugs, and routine listings.";

export type CoachingNote = {
  text: string;
  at: string;
};

export type CoachingBook = {
  notes: CoachingNote[];
};

const MAX_NOTES = 12;
const MAX_CHARS = 240;

export function readBook(value: unknown): CoachingBook {
  if (!value || typeof value !== "object" || !("notes" in value)) return { notes: [] };
  const raw = (value as { notes?: unknown }).notes;
  if (!Array.isArray(raw)) return { notes: [] };
  const notes: CoachingNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { text?: unknown; at?: unknown };
    if (typeof row.text !== "string") continue;
    const text = row.text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
    if (!text) continue;
    notes.push({ text, at: typeof row.at === "string" ? row.at : "" });
  }
  return { notes: notes.slice(0, MAX_NOTES) };
}

export function addNote(
  book: CoachingBook,
  text: string,
  at: string,
): { book: CoachingBook; stored: boolean } {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!clean) return { book, stored: false };
  if (book.notes.some((note) => note.text === clean)) return { book, stored: false };
  return {
    book: { notes: [{ text: clean, at }, ...book.notes].slice(0, MAX_NOTES) },
    stored: true,
  };
}
