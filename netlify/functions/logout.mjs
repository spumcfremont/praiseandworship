import { clearSessionCookie } from "../lib/session.mjs";

export default async () => Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });

export const config = { path: "/api/logout", method: "POST" };
