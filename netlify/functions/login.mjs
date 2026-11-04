import { checkPassword, createSessionCookie, isConfigured } from "../lib/session.mjs";

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!isConfigured()) {
    return Response.json({ error: "The site password hasn't been set up yet." }, { status: 500 });
  }
  let password = "";
  try {
    ({ password } = await req.json());
  } catch {}
  if (!(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 600));
    return Response.json({ error: "That password didn't work." }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSessionCookie() } });
};

export const config = {
  path: "/api/login",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
