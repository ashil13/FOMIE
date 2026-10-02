import { getStore } from "@netlify/blobs";

// Change the model name here if Google renames it (check Google AI Studio).
const MODEL = "gemini-2.5-flash-image";
const DAILY_LIMIT = 3;
const VIBES = {
  degen: "chaotic and bold; accessories like a crown or red horns",
  builder: "focused and techy; accessories like a cap or a halo",
  artist: "creative and playful; accessories like a beret",
  chill: "relaxed and calm; cozy outfit",
};
const reply = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export const config = { path: "/api/generate" };

export default async (req, context) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply({ error: "Server is missing GEMINI_API_KEY" }, 500);

  let body;
  try { body = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }
  const handle = String(body.handle || "").replace(/[^\w.]/g, "").slice(0, 30) || "anon";
  const vibe = VIBES[body.vibe] ? body.vibe : "chill";
  const bio = String(body.bio || "").slice(0, 200);

  // daily limit per visitor (if storage fails we let the request through)
  let store, rk, used = 0;
  try {
    store = getStore("rate");
    rk = `${new Date().toISOString().slice(0, 10)}:${context.ip}`;
    used = parseInt((await store.get(rk)) || "0", 10);
  } catch {}
  if (used >= DAILY_LIMIT) return reply({ error: `Daily limit reached (${DAILY_LIMIT}). Come back tomorrow.` }, 429);

  const refs = [];
  for (const n of [1, 2, 3, 4]) {
    const r = await fetch(new URL(`/refs/${n}.png`, req.url));
    if (r.ok) refs.push({ inline_data: { mime_type: "image/png", data: Buffer.from(await r.arrayBuffer()).toString("base64") } });
  }

  const prompt =
    "Using the attached reference images as the exact art style, create ONE new character from the same family: " +
    "big round white eyes with dark rectangular screens inside (each screen shows a small symbol), thick outlines, " +
    "flat colors, bust framing, solid single-color background. " +
    `Personality: ${VIBES[vibe]}. ` + (bio ? `Interests: ${bio}. ` : "") +
    `Choose outfit, accessory, eye symbol and background color to suit this person (${handle}). ` +
    "Do not copy a reference exactly. No text or watermark.";

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...refs] }], generationConfig: { responseModalities: ["IMAGE"] } }),
  });
  if (!r.ok) return reply({ error: "Image service error", detail: (await r.text()).slice(0, 300) }, 502);

  const parts = (await r.json())?.candidates?.[0]?.content?.parts || [];
  const p = parts.find((x) => x.inlineData || x.inline_data);
  const img = p && (p.inlineData || p.inline_data);
  if (!img) return reply({ error: "No image returned. Try again." }, 502);

  try { await store.set(rk, String(used + 1)); } catch {}
  return reply({ image: `data:${img.mimeType || img.mime_type || "image/png"};base64,${img.data}`, left: DAILY_LIMIT - used - 1 });
};
