/**
 * Konto über den eigenen Sync-Server (server/): Benutzername + Passwort, Sitzungstoken als
 * Bearer-Header (keine Cookies – das Spiel liegt auf einer anderen Domain), Spielstand per
 * GET/PUT /api/save, Live-Änderungen per Server-Sent Events (/api/events mit kurzlebigem,
 * einmaligem Ticket, weil EventSource keine Header senden kann).
 */
import { backoffMs, type RemoteMeta } from './policy';
import { AccountError, type AccountErrorCode, type AccountService, type AccountUser, type RemoteSave, type SaveWrite, type SyncBackend, type WriteResult } from './types';

/** Sitzung im localStorage: { token, username }. */
export const SESSION_KEY = 'vszw-session';

export interface HttpDeps {
  fetch: typeof fetch;
  storage: Storage;
  /** Fehlt (z. B. in Node), gibt es keine Live-Änderungen – der Abgleich bemerkt sie beim nächsten Push. */
  EventSource?: typeof EventSource;
}

interface StoredSession {
  token: string;
  username: string;
}

const SERVER_CODES: readonly AccountErrorCode[] = [
  'invalid-username',
  'invalid-password',
  'taken',
  'credentials',
  'rate-limited',
  'registration-closed',
  'storage-full',
];

/** Endliche Zahl oder undefined. */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Basis-URL ohne abschließenden Schrägstrich. */
export function apiBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function createHttpService(baseUrl: string, deps: HttpDeps): AccountService {
  const base = apiBase(baseUrl);
  const listeners: ((user: AccountUser | null) => void)[] = [];

  function loadSession(): StoredSession | null {
    try {
      const data: unknown = JSON.parse(deps.storage.getItem(SESSION_KEY) ?? 'null');
      if (typeof data !== 'object' || data === null) return null;
      const { token, username } = data as Record<string, unknown>;
      return typeof token === 'string' && typeof username === 'string' && token && username ? { token, username } : null;
    } catch {
      return null;
    }
  }

  function storeSession(session: StoredSession | null): void {
    try {
      if (session) deps.storage.setItem(SESSION_KEY, JSON.stringify(session));
      else deps.storage.removeItem(SESSION_KEY);
    } catch {
      // Speicher blockiert: Anmeldung gilt nur bis zum Neuladen.
    }
  }

  /**
   * Sitzung ungültig (401): vergessen und melden – aber nur, wenn noch genau das gesendete
   * Token gespeichert ist. Hat sich ein anderer Tab inzwischen neu angemeldet, bleibt dessen
   * Sitzung unangetastet.
   */
  function expire(sentToken: string): void {
    if (loadSession()?.token !== sentToken) return;
    storeSession(null);
    for (const listener of listeners) listener(null);
  }

  /**
   * Anfrage an den Server. `auth`: false = ohne Token; true = mit der gespeicherten Sitzung;
   * ein Benutzername = nur, wenn die gespeicherte Sitzung (noch) zu genau diesem Konto gehört.
   * Die Sitzung liegt im localStorage, den alle Tabs teilen: Meldet sich ein anderer Tab mit
   * einem anderen Konto an, darf dieser Tab nie mit dessen Token schreiben.
   */
  async function request(method: string, path: string, body?: unknown, auth: boolean | string = true): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let sentToken = '';
    if (auth !== false) {
      const session = loadSession();
      if (!session) throw new AccountError('unauthorized');
      if (typeof auth === 'string' && session.username !== auth) throw new AccountError('unauthorized');
      sentToken = session.token;
      headers.Authorization = `Bearer ${session.token}`;
    }
    let res: Response;
    try {
      res = await deps.fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new AccountError('network');
    }
    let json: unknown = null;
    if (res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    if (res.status === 401 && auth !== false) {
      expire(sentToken);
      throw new AccountError('unauthorized');
    }
    return { status: res.status, json };
  }

  function errorFrom(status: number, json: unknown): AccountError {
    const code = (json as { error?: unknown } | null)?.error;
    if (status === 429) return new AccountError('rate-limited');
    if (status === 401) return new AccountError('credentials');
    if (status === 507) return new AccountError('storage-full');
    return new AccountError(SERVER_CODES.includes(code as AccountErrorCode) ? (code as AccountErrorCode) : 'server');
  }

  async function authenticate(path: string, username: string, password: string): Promise<AccountUser> {
    const { status, json } = await request('POST', path, { username, password }, false);
    const result = json as { token?: unknown; username?: unknown } | null;
    if ((status === 200 || status === 201) && typeof result?.token === 'string' && typeof result.username === 'string') {
      storeSession({ token: result.token, username: result.username });
      return { name: result.username };
    }
    throw errorFrom(status, json);
  }

  function toRemote(json: unknown): RemoteSave | null {
    const row = json as Record<string, unknown> | null;
    if (!row || typeof row.data !== 'string' || typeof row.version !== 'number') return null;
    const remote: RemoteSave = {
      data: row.data,
      version: row.version,
      actionVersion: typeof row.actionVersion === 'number' ? row.actionVersion : 0,
      device: typeof row.deviceId === 'string' ? row.deviceId : '',
      schema: finite(row.schema) ?? 0,
    };
    // Alter allein nach der Uhr des Servers – die Uhren der Geräte dürfen falsch gehen.
    const serverTime = finite(row.serverTime);
    const updatedAt = finite(row.updatedAt);
    if (serverTime !== undefined && updatedAt !== undefined) remote.ageMs = Math.max(0, serverTime - updatedAt);
    return remote;
  }

  async function put(user: string, baseVersion: number, row: SaveWrite, action: boolean): Promise<WriteResult> {
    const { status, json } = await request('PUT', '/api/save', {
      data: row.data,
      baseVersion,
      deviceId: row.device,
      action,
      schema: row.schema,
    }, user);
    if (status === 200) return 'ok';
    if (status === 409) return 'conflict';
    if (status === 422 && (json as { error?: unknown } | null)?.error === 'outdated-client') return 'outdated';
    throw new AccountError(status === 507 ? 'storage-full' : 'server');
  }

  /** Zugriff auf den Stand von `user` – nie mit der Sitzung eines anderen Kontos. */
  const backendFor = (user: string): SyncBackend => ({
    async fetch() {
      const { status, json } = await request('GET', '/api/save', undefined, user);
      if (status === 204) return null;
      if (status !== 200) throw new AccountError('server');
      return toRemote(json);
    },
    insert: (row) => put(user, 0, row, true),
    update: (expected, row) => put(user, expected, row, row.actionVersion !== undefined),
    subscribe(listener) {
      const Source = deps.EventSource;
      if (!Source) return () => {};
      let stopped = false;
      let source: EventSource | null = null;
      let failures = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const retry = () => {
        source?.close();
        source = null;
        if (stopped) return;
        failures++;
        timer = setTimeout(connect, backoffMs(failures));
      };

      async function connect(): Promise<void> {
        if (stopped) return;
        let ticket: string;
        try {
          const { status, json } = await request('POST', '/api/events/ticket', undefined, user);
          const value = (json as { ticket?: unknown } | null)?.ticket;
          if (status !== 200 || typeof value !== 'string') throw new AccountError('server');
          ticket = value;
        } catch (error) {
          // Abgemeldet: nicht weiter versuchen.
          if (error instanceof AccountError && error.code === 'unauthorized') return;
          retry();
          return;
        }
        if (stopped) return;
        const es = new Source!(`${base}/api/events?ticket=${encodeURIComponent(ticket)}`);
        source = es;
        es.addEventListener('ready', () => {
          failures = 0;
          listener(null);
        });
        es.addEventListener('save', (event) => {
          try {
            const data = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
            const change: RemoteMeta = {
              version: Number(data.version),
              actionVersion: Number(data.actionVersion),
              device: typeof data.deviceId === 'string' ? data.deviceId : '',
              schema: finite(data.schema) ?? 0,
            };
            listener(Number.isFinite(change.version) ? change : null);
          } catch {
            listener(null);
          }
        });
        // Das Ticket gilt nur einmal: Bei Abbruch selbst mit neuem Ticket verbinden.
        es.onerror = retry;
      }

      void connect();
      return () => {
        stopped = true;
        clearTimeout(timer);
        source?.close();
        source = null;
      };
    },
  });

  return {
    async currentUser() {
      const session = loadSession();
      if (!session) return null;
      try {
        const { status, json } = await request('GET', '/api/me');
        const name = (json as { username?: unknown } | null)?.username;
        if (status === 200 && typeof name === 'string') return { name };
      } catch (error) {
        if (error instanceof AccountError && error.code === 'unauthorized') return null;
      }
      // Offline oder Serverfehler: angemeldet bleiben, der Abgleich versucht es später.
      return { name: session.username };
    },
    onUserChange(listener) {
      listeners.push(listener);
    },
    signIn: (username, password) => authenticate('/api/login', username, password),
    register: (username, password) => authenticate('/api/register', username, password),
    async signOut(user) {
      // Nur die eigene Sitzung beenden: Gehört die gespeicherte inzwischen einem anderen Konto
      // (anderer Tab), bleibt sie unangetastet.
      const session = loadSession();
      if (!session || (user && session.username !== user.name)) return;
      try {
        await request('POST', '/api/logout', undefined, session.username);
      } catch {
        // Offline: Die Sitzung läuft auf dem Server irgendwann ab; hier ist sie vergessen.
      }
      if (loadSession()?.token === session.token) storeSession(null);
    },
    sessionUser: () => loadSession()?.username ?? null,
    backend: (user) => backendFor(user.name),
  };
}
