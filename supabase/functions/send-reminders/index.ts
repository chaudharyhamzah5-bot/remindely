// Supabase Edge Function: send-reminders
// Called every minute by pg_cron (see setup.sql). Finds reminders that became due since the
// last run and sends a Web Push notification to every subscribed device.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const TZ_OFFSET_MIN = 300; // Asia/Karachi = UTC+05:00 (no DST). Change if you move.
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);

// deno-lint-ignore no-explicit-any
type Row = { id: string; kind: string; data: any };

const isExam = (t?: string) => /quiz|exam|mid|final|test/i.test(t || "");
const pad = (n: number) => String(n).padStart(2, "0");
const toM = (t: string) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const f12 = (t: string) => { const m = toM(t), h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${pad(m % 60)} ${h >= 12 ? "PM" : "AM"}`; };
const rel = (ms: number) => {
  const sec = Math.round(Math.abs(ms) / 1000);
  if (sec < 1) return "now";
  let x: string;
  if (sec < 60) x = sec + "s";
  else {
    const m = Math.round(Math.abs(ms) / 6e4), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), n = m % 60;
    x = d ? `${d}d ${h}h` : h ? `${h}h ${n}m` : `${n}m`;
  }
  return ms < 0 ? x + " ago" : "in " + x;
};
const localStr = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("unauthorized", { status: 401 });

  const now = Date.now();
  const { data: st } = await sb.from("push_state").select("last_run").eq("id", 1).maybeSingle();
  const last = Math.max(st?.last_run ? Date.parse(st.last_run) : now - 60000, now - 10 * 60000);
  await sb.from("push_state").upsert({ id: 1, last_run: new Date(now).toISOString() });

  const { data: rows, error } = await sb.from("items").select("id,kind,data")
    .in("kind", ["task", "class", "dsx", "subject", "prefs", "tttab", "push"]).eq("deleted", false);
  if (error) return new Response(error.message, { status: 500 });
  const all = (rows ?? []) as Row[];
  const by = (k: string) => all.filter((r) => r.kind === k);

  const subs = new Map(by("subject").map((s) => [s.id, s.data]));
  const sname = (id: string) => subs.get(id)?.name ?? "General";
  const prefs = by("prefs")[0]?.data?.rem ?? {};
  const def = { task: 3600, quiz: 86400, cls: 900, ...prefs };
  const remSec = (r: unknown, kind: string, type?: string) =>
    r === -1 ? -1 : typeof r === "number" ? r : kind === "cls" ? def.cls : isExam(type) ? def.quiz : def.task;

  const due: { tag: string; title: string; body: string }[] = [];
  const hit = (t: number) => t > last && t <= now;

  // tasks
  for (const t of by("task")) {
    const d = t.data;
    if (d.done || d.trashed || !d.due) continue;
    const L = remSec(d.rem, "task", d.type);
    if (L < 0) continue;
    const dueMs = Date.parse(d.due);
    if (hit(dueMs - L * 1000)) {
      due.push({ tag: t.id + d.due + L, title: `${d.type} due ${rel(dueMs - now)}`, body: `${d.title} · ${sname(d.subject)} · ${localStr(dueMs)}` });
    }
  }

  // classes of the active timetable only
  const tabs = by("tttab").sort((a, b) => (a.data.ord ?? 0) - (b.data.ord ?? 0) || a.id.localeCompare(b.id));
  const active = tabs.find((x) => x.data.active) ?? tabs[0];
  const local = new Date(now + TZ_OFFSET_MIN * 60000);
  const td = local.toISOString().slice(0, 10), dow = local.getUTCDay();
  for (const c of by("class")) {
    const d = c.data;
    if (+d.day !== dow || !d.start) continue;
    const tabId = tabs.some((x) => x.id === d.tt) ? d.tt : tabs[0]?.id;
    if (active && tabId !== active.id) continue;
    const L = remSec(d.rem, "cls");
    if (L < 0) continue;
    const st = Date.parse(`${td}T${d.start}:00Z`) - TZ_OFFSET_MIN * 60000;
    if (hit(st - L * 1000)) {
      due.push({ tag: c.id + td + L, title: `Class ${rel(st - now)}`, body: `${sname(d.subject)} · ${f12(d.start)}${d.room ? " · " + d.room : ""}` });
    }
  }

  // date sheet papers
  for (const x of by("dsx")) {
    const d = x.data;
    if (!d.date || !d.start) continue;
    const L = remSec(d.rem, "task", "Exam");
    if (L < 0) continue;
    const st = Date.parse(`${d.date}T${d.start}:00Z`) - TZ_OFFSET_MIN * 60000;
    if (hit(st - L * 1000)) {
      due.push({ tag: x.id + d.date + d.start + L, title: `Paper ${rel(st - now)}`, body: `${sname(d.subject)} · ${f12(d.start)}${d.room ? " · " + d.room : ""}` });
    }
  }

  let sent = 0, dead = 0;
  const devices = by("push").filter((p) => p.data?.sub?.endpoint);
  for (const n of due) {
    const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.tag, url: "./" });
    await Promise.all(devices.map(async (dv) => {
      try {
        await webpush.sendNotification(dv.data.sub, payload, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const code = (e as any)?.statusCode;
        if (code === 404 || code === 410) {
          dead++;
          await sb.from("items").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", dv.id);
        }
      }
    }));
  }
  return Response.json({ due: due.length, devices: devices.length, sent, removed: dead });
});
