// Shared password + session helpers. Uses only Web Crypto so it runs in both
// Netlify Functions (Node) and Edge Functions (Deno).
export const COOKIE = "pw_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const enc = new TextEncoder();

function env(name) {
  return globalThis.Netlify?.env?.get(name) ?? globalThis.process?.env?.[name];
}

function b64url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// The signing key mixes in the password, so changing SITE_PASSWORD signs everyone out.
async function signingKey() {
  const pw = env("SITE_PASSWORD");
  const secret = env("SESSION_SECRET");
  if (!pw || !secret) return null;
  return crypto.subtle.importKey("raw", enc.encode(`${secret}\u0000${pw}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(key, msg) {
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export function isConfigured() {
  return Boolean(env("SITE_PASSWORD") && env("SESSION_SECRET"));
}

export async function checkPassword(input) {
  const pw = env("SITE_PASSWORD");
  if (!pw || typeof input !== "string") return false;
  const [a, b] = await Promise.all([input, pw].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return safeEqual(b64url(a), b64url(b));
}

export async function createSessionCookie() {
  const key = await signingKey();
  if (!key) throw new Error("Site password is not configured");
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `v1.${exp}`;
  const token = `${payload}.${await sign(key, payload)}`;
  return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function verifySession(token) {
  if (!token) return false;
  const key = await signingKey();
  if (!key) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return safeEqual(parts[2], await sign(key, `v1.${parts[1]}`));
}
