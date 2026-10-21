/**
 * HTTP-Server um den Handler aus app.ts – mit Zeitgrenzen gegen langsame Clients.
 *
 * `requestTimeout` gilt nur, bis die Anfrage (Kopf + Körper) vollständig angekommen ist;
 * die Antwort eines Event-Streams (/api/events) darf danach beliebig lange offen bleiben.
 */
import { createServer, type Server } from 'node:http';
import type { App } from './app';

export interface ServerTimeouts {
  /** Ganze Anfrage empfangen (ms). */
  requestTimeout?: number;
  /** Kopfzeilen empfangen (ms), höchstens requestTimeout. */
  headersTimeout?: number;
  /** Wie oft Node die Zeitgrenzen prüft (ms). */
  connectionsCheckingInterval?: number;
}

export function createSyncServer(app: App, timeouts: ServerTimeouts = {}): Server {
  const requestTimeout = timeouts.requestTimeout ?? 30_000;
  const server = createServer(
    {
      requestTimeout,
      headersTimeout: Math.min(timeouts.headersTimeout ?? 20_000, requestTimeout),
      connectionsCheckingInterval: timeouts.connectionsCheckingInterval ?? 5_000,
    },
    app.handle,
  );
  // Kaputte Anfrage-Zeilen beantwortet Node selbst; nur nie mit einem Fehler den Prozess beenden.
  server.on('clientError', (error: NodeJS.ErrnoException, socket) => {
    if (!socket.writable || socket.destroyed) {
      socket.destroy();
      return;
    }
    const status = error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout' : '400 Bad Request';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  });
  return server;
}
