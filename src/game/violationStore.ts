import type { ViolationRecord } from "./traffic";

/**
 * 違反の記録 kept in this browser: every violation, caught or not, with the screen at that moment,
 * survives reloading the page, the end of the day and the 講習 after a suspension (which clears the
 * licence's points, not the history). One IndexedDB object store, keyed by the record's id.
 *
 * Why not localStorage: each record carries a JPEG of the screen (~50–150 KB), and localStorage's
 * ~5 MB would be full after a few dozen. Why not the artifact/server: the history is the player's own
 * and stays on their device.
 */
const DB_NAME = "tod-violations";
const STORE = "records";
/** The oldest records go once there are more than this many (each holds a picture). */
const KEEP = 500;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db: Promise<IDBDatabase> | null = null;
const database = () => (db ??= open());

/** Every saved record, oldest first; empty when storage is unavailable (private window, previews). */
export async function loadViolations(): Promise<ViolationRecord[]> {
  try {
    const d = await database();
    const all = await new Promise<ViolationRecord[]>((resolve, reject) => {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as ViolationRecord[]);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
  } catch {
    return [];
  }
}

/** Saves (or updates) records; trims the oldest beyond KEEP. Failures are ignored: the game goes on. */
export async function saveViolations(records: readonly ViolationRecord[], total: number): Promise<void> {
  if (records.length === 0) return;
  try {
    const d = await database();
    const tx = d.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const r of records) store.put(r);
    if (total > KEEP) {
      // Keys are "<savedAt>-<n>" (zero-padded), so the cursor walks oldest first.
      let excess = total - KEEP;
      store.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor || excess <= 0) return;
        cursor.delete();
        excess--;
        cursor.continue();
      };
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Storage blocked or full: the record still shows for this session.
  }
}

/**
 * Which records changed since they were last saved: a record is saved when it appears and again
 * when its status, detector or screen picture is filled in.
 */
export class ViolationSync {
  private readonly saved = new Map<string, string>();

  changed(log: readonly ViolationRecord[]): ViolationRecord[] {
    const out: ViolationRecord[] = [];
    for (const r of log) {
      if (!r.id) continue;
      // The pursuit can change a record after the fact: its 反則金 gone (procedure), its points
      // taken into 危険運転致傷's (absorbedBy).
      const signature = `${r.status}|${r.by ?? ""}|${r.context?.snapshot?.length ?? 0}|${r.replay ? 1 : 0}|${r.fine}|${r.points}|${r.procedure ?? ""}`;
      if (this.saved.get(r.id) === signature) continue;
      this.saved.set(r.id, signature);
      out.push(r);
    }
    return out;
  }
}
