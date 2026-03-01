// get-availability — Booking Engine: slots disponibles según Google Calendar
// Supabase Edge Function (Deno) — Senior Backend Engineer

import { createClient } from "supabase";
import { google } from "googleapis";

// ——— CORS: permitir llamadas desde frontend (Vercel, etc.) ———
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLOT_STEP_MINUTES = 30;
const DAY_START = 8; // 08:00 (hora local Argentina)
const DAY_END = 21;  // 21:00 (hora local Argentina)

/** Offset ISO para Argentina (sin DST). */
const ARGENTINA_OFFSET = "-03:00";

type RequestBody = {
  professional_id: string;
  service_item_id: string;
  date: string; // YYYY-MM-DD
};

/** Formatea minutos desde medianoche como "HH:mm" (hora local Argentina en los slots). */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Devuelve el rango del día en Argentina para la fecha dada: 00:00 y 23:59:59.999
 * en ISO con offset -03:00, para consultar a Google Calendar.
 */
function getArgentinaDayRange(dateStr: string): { timeMin: string; timeMax: string; dayStartMs: number; dayEndMs: number } {
  const timeMin = `${dateStr}T00:00:00${ARGENTINA_OFFSET}`;
  const timeMax = `${dateStr}T23:59:59.999${ARGENTINA_OFFSET}`;
  const dayStartMs = new Date(timeMin).getTime();
  const dayEndMs = new Date(timeMax).getTime();
  return { timeMin, timeMax, dayStartMs, dayEndMs };
}

/** Genera slots cada SLOT_STEP_MINUTES en [dayStartMin, dayEndMin). */
function generateSlotStarts(dayStartMin: number, dayEndMin: number): number[] {
  const slots: number[] = [];
  for (let t = dayStartMin; t < dayEndMin; t += SLOT_STEP_MINUTES) {
    slots.push(t);
  }
  return slots;
}

/** Indica si [startMin, endMin) choca con algún bloque ocupado (en minutos del día). */
function isSlotFree(
  startMin: number,
  endMin: number,
  busyMinutes: Array<[number, number]>
): boolean {
  for (const [bStart, bEnd] of busyMinutes) {
    if (startMin < bEnd && endMin > bStart) return false;
  }
  return true;
}

/**
 * Convierte eventos "busy" de Google (RFC3339) a intervalos en minutos desde medianoche
 * del día en Argentina. Usa dayStartMs/dayEndMs del rango Argentina para recortar
 * eventos que se solapan con ese día.
 */
function busyEventsToMinutes(
  busy: Array<{ start?: string; end?: string }>,
  dayStartMs: number,
  dayEndMs: number
): Array<[number, number]> {
  return busy
    .filter((e) => e.start && e.end)
    .map((e) => {
      const eventStartMs = new Date(e.start!).getTime();
      const eventEndMs = new Date(e.end!).getTime();
      const overlapStart = Math.max(eventStartMs, dayStartMs);
      const overlapEnd = Math.min(eventEndMs, dayEndMs);
      if (overlapStart >= overlapEnd) return null;
      const startMin = (overlapStart - dayStartMs) / 60000;
      const endMin = (overlapEnd - dayStartMs) / 60000;
      return [startMin, endMin] as [number, number];
    })
    .filter((x): x is [number, number] => x !== null && x[0] < x[1]);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método no permitido. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "Cuerpo JSON inválido." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { professional_id, service_item_id, date } = body;
  if (!professional_id || !service_item_id || !date) {
    return new Response(
      JSON.stringify({
        error: "Faltan campos requeridos: professional_id, service_item_id, date.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return new Response(
      JSON.stringify({ error: "Formato de fecha inválido. Use YYYY-MM-DD." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1) Obtener google_calendar_id del profesional
  const { data: prof, error: profError } = await supabase
    .from("profesionales")
    .select("google_calendar_id")
    .eq("id", professional_id)
    .single();

  if (profError || !prof?.google_calendar_id) {
    return new Response(
      JSON.stringify({
        error: "Profesional no encontrado o sin google_calendar_id configurado.",
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const calendarId = prof.google_calendar_id;

  // 2) Obtener duracion_minutos del servicio (servicios_items)
  const { data: item, error: itemError } = await supabase
    .from("servicios_items")
    .select("duracion_minutos")
    .eq("id", service_item_id)
    .single();

  if (itemError || !item?.duracion_minutos) {
    return new Response(
      JSON.stringify({
        error: "Servicio no encontrado o sin duracion_minutos.",
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const duracionMinutos = Number(item.duracion_minutos);
  if (!Number.isInteger(duracionMinutos) || duracionMinutos <= 0) {
    return new Response(
      JSON.stringify({ error: "duracion_minutos inválido para este servicio." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 3) Google Calendar API — freebusy
  const googRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!googRaw) {
    return new Response(
      JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT no configurado." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(googRaw) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT: JSON inválido." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const calendar = google.calendar({ version: "v3", auth });

  // Rango del día en Argentina (00:00 y 23:59) para la consulta freebusy
  const { timeMin, timeMax, dayStartMs, dayEndMs } = getArgentinaDayRange(date);

  let freebusyRes;
  try {
    freebusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      },
    });
  } catch (err) {
    console.error("Google Calendar freebusy error:", err);
    return new Response(
      JSON.stringify({
        error: "Error al consultar disponibilidad en Google Calendar.",
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const calBusy = freebusyRes?.data?.calendars?.[calendarId]?.busy ?? [];
  const busyMinutes = busyEventsToMinutes(calBusy, dayStartMs, dayEndMs);

  // Slots 08:00–21:00 hora Argentina, cada 30 min; solo si cabe duracion_minutos
  const dayStartMin = DAY_START * 60;
  const dayEndMin = DAY_END * 60;
  const slotStarts = generateSlotStarts(dayStartMin, dayEndMin);
  const slots: string[] = [];

  for (const startMin of slotStarts) {
    const endMin = startMin + duracionMinutos;
    if (endMin > dayEndMin) continue;
    if (isSlotFree(startMin, endMin, busyMinutes)) {
      slots.push(minutesToTime(startMin)); // "09:00", "09:30" = hora local Argentina
    }
  }

  return new Response(JSON.stringify({ slots }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
