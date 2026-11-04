// Runs before every request: only visitors with a valid session get through.
import { COOKIE, verifySession } from "../lib/session.mjs";

export default async (request, context) => {
  if (await verifySession(context.cookies.get(COOKIE))) return context.next();

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "Please sign in." }, { status: 401 });
  }
  const login = new URL("/login", url);
  if (url.pathname !== "/") login.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(login, 302);
};

export const config = {
  path: "/*",
  excludedPath: ["/login", "/login.html", "/login.js", "/api/login", "/styles.css", "/favicon.svg", "/robots.txt",
    "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
    "/praise-team.png", "/saint-paul-logo.png", "/favicon-32.png",
    "/install", "/install.html", "/install.js", "/sw.js"],
};
