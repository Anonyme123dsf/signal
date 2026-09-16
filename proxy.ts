import { NextResponse, type NextRequest } from "next/server";

const REALM = "Signal Arbitrage";

function unauthorized(message: string): NextResponse {
  return new NextResponse(message, {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

/** Vergleich in konstanter Zeit, damit die Länge oder ein früher Unterschied nichts verrät. */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Schützt das Arbitrage-Dashboard mit HTTP Basic Auth. Dort werden Paper-Deals angelegt
 * und E-Mails freigegeben, das darf nicht offen im Netz stehen.
 * DASHBOARD_PASSWORD setzen (optional DASHBOARD_USER, Standard "admin"). Ohne Passwort ist
 * der Bereich in Produktion gesperrt (503) und nur in der lokalen Entwicklung offen.
 */
export default function proxy(request: NextRequest): NextResponse {
  const user = process.env.DASHBOARD_USER ?? "admin";
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Dashboard gesperrt: DASHBOARD_PASSWORD ist nicht gesetzt.", { status: 503 });
    }
    return NextResponse.next();
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return unauthorized("Anmeldung erforderlich");
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized("Ungültige Anmeldung");
  }
  const sep = decoded.indexOf(":");
  const givenUser = sep >= 0 ? decoded.slice(0, sep) : decoded;
  const givenPassword = sep >= 0 ? decoded.slice(sep + 1) : "";
  if (!safeEqual(givenUser, user) || !safeEqual(givenPassword, password)) return unauthorized("Falsche Zugangsdaten");
  return NextResponse.next();
}

export const config = {
  matcher: ["/arbitrage/:path*"],
};
