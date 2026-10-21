/**
 * Client-IP hinter einem Reverse-Proxy – ohne einem gefälschten X-Forwarded-For zu glauben.
 *
 * Nur wenn die Verbindung selbst von einer privaten Adresse kommt (Proxy im selben
 * Docker-Netz oder auf demselben Server), zählt X-Forwarded-For – und davon der LETZTE
 * Eintrag: den hat unser Proxy angehängt. Alles davor kann der Client frei erfinden.
 */

/** IPv4-Adresse als Zahlen oder null. */
function ipv4(address: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return null;
  const parts = m.slice(1).map(Number) as [number, number, number, number];
  return parts.every((n) => n <= 255) ? parts : null;
}

/** `::ffff:10.0.0.1` → `10.0.0.1`; Kleinschreibung, ohne Zonen-Index. */
export function normalizeIp(address: string): string {
  const plain = address.trim().toLowerCase().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(plain);
  return mapped ? mapped[1]! : plain;
}

/** Loopback, privat (RFC 1918), Link-Local, CGNAT (Docker/Proxy-Netze) oder IPv6 ULA/Loopback. */
export function isPrivateIp(address: string): boolean {
  const ip = normalizeIp(address);
  const v4 = ipv4(ip);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/**
 * IP für Rate-Limits: `remote` ist die Adresse der TCP-Verbindung, `forwarded` der Kopf
 * X-Forwarded-For (auch mehrfach). Nur bei `trustProxy` und privater `remote` gilt der
 * letzte Eintrag des Kopfes.
 */
export function clientIp(remote: string | undefined, forwarded: string | string[] | undefined, trustProxy: boolean): string {
  const direct = remote ? normalizeIp(remote) : 'unknown';
  if (!trustProxy || !remote || !isPrivateIp(remote) || forwarded === undefined) return direct;
  const entries = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded).split(',');
  const last = entries[entries.length - 1]?.trim() ?? '';
  // Nur etwas, das wie eine Adresse aussieht (kein beliebig langer Text als Map-Schlüssel).
  return /^[0-9a-fA-F:.]{2,45}$/.test(last) ? normalizeIp(last) : direct;
}
