/**
 * Minimal synchronous key-value storage contract implemented by browser
 * `localStorage` on Web and `react-native-mmkv` on iOS/Android.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export interface PreferenceStore<T> {
  load(): T;
  save(value: T): void;
  getSnapshot(): T;
  getDefaultSnapshot(): T;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<T>): T;
  reload(): T;
}

/**
 * Creates a backward-compatible, reactive preference store backed by any
 * synchronous KeyValueStorage (compatible with React 19 `useSyncExternalStore`).
 */
export function createPreferenceStore<T extends object>(options: {
  storageKey: string;
  defaults: T;
  parse: (raw: unknown) => T;
  storage: KeyValueStorage;
}): PreferenceStore<T> {
  const { storageKey, defaults, parse, storage } = options;
  let cachedSnapshot: T | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const load = (): T => {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return parse(null);
      return parse(JSON.parse(raw));
    } catch {
      return parse(null);
    }
  };

  const save = (value: T): void => {
    try {
      storage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  };

  const getSnapshot = (): T => {
    if (!cachedSnapshot) {
      cachedSnapshot = load();
    }
    return cachedSnapshot;
  };

  const reload = (): T => {
    cachedSnapshot = load();
    notify();
    return cachedSnapshot;
  };

  return {
    load,
    save,
    getSnapshot,
    getDefaultSnapshot: () => defaults,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch) {
      const current = getSnapshot();
      const next = parse({ ...current, ...patch });
      cachedSnapshot = next;
      save(next);
      notify();
      return next;
    },
    reload,
  };
}
