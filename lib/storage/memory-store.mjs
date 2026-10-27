// In-process store with the same API as a Netlify Blobs store. Used by tests
// and by local runs with MAKEABLE_STORAGE_BACKEND=memory.
export function createMemoryStore() {
  const entries = new Map();

  function sortedKeys(prefix = "") {
    return [...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  return {
    async get(key, options = {}) {
      const entry = entries.get(key);
      if (!entry) return null;
      return decodeEntry(entry, options.type);
    },
    async set(key, value, options = {}) {
      if (options.onlyIfNew && entries.has(key)) return { modified: false };
      entries.set(key, await encodeValue(value, options.metadata));
      return { modified: true };
    },
    async setJSON(key, value, options = {}) {
      return this.set(key, new Blob([JSON.stringify(value)], { type: "application/json" }), options);
    },
    async delete(key) {
      entries.delete(key);
    },
    list(options = {}) {
      const blobs = sortedKeys(options.prefix).map((key) => ({ key }));
      if (options.paginate) {
        return (async function* pages() {
          yield { blobs, directories: [] };
        })();
      }
      return Promise.resolve({ blobs, directories: [] });
    },
  };
}

export async function encodeValue(value, metadata = {}) {
  if (value instanceof Blob) {
    return {
      bytes: new Uint8Array(await value.arrayBuffer()),
      contentType: value.type || "",
      metadata: { ...metadata },
    };
  }
  return {
    bytes: new TextEncoder().encode(String(value)),
    contentType: "text/plain",
    metadata: { ...metadata },
  };
}

export function decodeEntry(entry, type) {
  if (type === "json") return JSON.parse(new TextDecoder().decode(entry.bytes));
  if (type === "arrayBuffer") return entry.bytes.slice().buffer;
  if (type === "blob") return new Blob([entry.bytes], { type: entry.contentType });
  return new TextDecoder().decode(entry.bytes);
}
