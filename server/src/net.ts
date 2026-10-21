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

/** IPv6 in 8 Gruppen (Zahlen) oder null. Eingebettetes IPv4 am Ende zählt als zwei Gruppen. */
function ipv6Groups(address: string): number[] | null {
  const parts = address.split('::');
  if (parts.length > 2) return null;
  const toGroups = (text: string): number[] | null => {
    if (text === '') return [];
    const out: number[] = [];
    for (const piece of text.split(':')) {
      if (piece.includes('.')) {
        const v4 = ipv4(piece);
        if (!v4) return null;
        out.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        out.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = toGroups(parts[0]!);
  const tail = parts.length === 2 ? toGroups(parts[1]!) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (parts.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

/**
 * Schlüssel für Rate-Limits: IPv4 wie sie ist, IPv6 gebündelt auf das /64-Netz – ein
 * Anschluss bekommt meist ein ganzes /64 und könnte sonst beliebig viele Adressen nutzen.
 */
export function rateKey(address: string): string {
  const ip = normalizeIp(address);
  if (!ip.includes(':')) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
