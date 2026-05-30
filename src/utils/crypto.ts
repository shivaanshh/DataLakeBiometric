// Embeddings are stored as plain JSON in SQLite (see src/storage/db.ts).
// Hermes JS engine does not support crypto.subtle or Node's Buffer —
// no encryption layer is used in this version.
export {};
