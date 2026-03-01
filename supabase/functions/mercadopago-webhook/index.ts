// mercadopago-webhook — Confirma la reserva al aprobar el pago (seña)
// Supabase Edge Function (Deno) — Senior Backend Developer

import { createClient } from "supabase";
import { google } from "googleapis";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ARGENTINA_OFFSET = "-03:00";
const MP_PAYMENTS_URL = "https://api.mercadopago.com/v1/payments";

type WebhookPayload = {
  type?: string;
  data?: { id?: string };
};

type ExternalRef = {
  professional_id: string;
  service_item_id: string;
  date: string;
  time: string;
  client_data?: {
    nombre?: string;
    apellido?: string;
    email?: string;
    telefono?: string;
  };
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Construye fecha/hora inicio y fin en Argentina (ISO con offset -03:00).
 * Reutiliza la misma lógica de zona horaria que get-availability.
 */
function buildArgentinaDatetime(
  dateStr: string,
  timeStr: string,
  durationMinutes: number
): { startISO: string; endISO: string } {
  const [h, m] = timeStr.split(":").map(Number);
  const startISO = `${dateStr}T${pad2(h)}:${pad2(m)}:00${ARGENTINA_OFFSET}`;
  const totalMin = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMin / 60);
  const endM = totalMin % 60;
  const endISO = `${dateStr}T${pad2(endH)}:${pad2(endM)}:00${ARGENTINA_OFFSET}`;
  return { startISO, endISO };
}

function withCors(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return withCors(JSON.stringify({ error: "Method not allowed" }), 405);
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (payload.type !== "payment") {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const paymentId = payload.data?.id;
  if (!paymentId) {
    return new Response(JSON.stringify({ error: "Missing data.id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!mpToken) {
    console.error("mercadopago-webhook: MP_ACCESS_TOKEN not set");
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const paymentRes = await fetch(`${MP_PAYMENTS_URL}/${paymentId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  });

  if (!paymentRes.ok) {
    console.error("mercadopago-webhook: MP GET payment failed", paymentRes.status);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payment = (await paymentRes.json()) as {
    status?: string;
    external_reference?: string;
    transaction_amount?: number;
  };

  if (payment.status !== "approved") {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: existing } = await supabase
    .from("agenda_turnos")
    .select("id")
    .eq("mp_payment_id", paymentId)
    .maybeSingle();
  if (existing) {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let ref: ExternalRef;
  try {
    ref = JSON.parse(payment.external_reference || "{}") as ExternalRef;
  } catch {
    console.error("mercadopago-webhook: invalid external_reference", payment.external_reference);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { professional_id, service_item_id, date, time, client_data } = ref;
  if (!professional_id || !service_item_id || !date || !time) {
    console.error("mercadopago-webhook: missing fields in external_reference", ref);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: item, error: itemError } = await supabase
    .from("servicios_items")
    .select("duracion_minutos, nombre")
    .eq("id", service_item_id)
    .single();

  if (itemError || !item?.duracion_minutos) {
    console.error("mercadopago-webhook: servicio no encontrado", service_item_id, itemError);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const duracionMinutos = Number(item.duracion_minutos);
  const servicioNombre = (item.nombre as string) || "Turno";
  const { startISO, endISO: endISOForGoogle } = buildArgentinaDatetime(date, time, duracionMinutos);

  const clientName = [client_data?.nombre, client_data?.apellido].filter(Boolean).join(" ") || "Paciente";
  const eventTitle = `Turno: ${servicioNombre} - ${clientName}`;

  let googleEventId: string | null = null;
  const googRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (googRaw) {
    try {
      const credentials = JSON.parse(googRaw) as Record<string, unknown>;
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      });
      const calendar = google.calendar({ version: "v3", auth });

      const { data: prof } = await supabase
        .from("profesionales")
        .select("google_calendar_id, nombre")
        .eq("id", professional_id)
        .single();

      if (prof?.google_calendar_id) {
        const ev = await calendar.events.insert({
          calendarId: prof.google_calendar_id,
          requestBody: {
            summary: eventTitle,
            start: { dateTime: startISO, timeZone: "America/Argentina/Buenos_Aires" },
            end: { dateTime: endISOForGoogle, timeZone: "America/Argentina/Buenos_Aires" },
          },
        });
        googleEventId = ev.data.id ?? null;
      }
    } catch (err) {
      console.error("mercadopago-webhook: Google Calendar error", err);
    }
  }

  const profesionalNombre = (await supabase
    .from("profesionales")
    .select("nombre")
    .eq("id", professional_id)
    .single()).data?.nombre as string | undefined;

  const insertPayload: Record<string, unknown> = {
    fecha_inicio: startISO,
    profesional: profesionalNombre ?? professional_id,
    tratamiento: servicioNombre,
    monto_sena: payment.transaction_amount ?? 0,
    precio_total: payment.transaction_amount ?? 0,
    estado_pago: "confirmado",
    google_event_id: googleEventId,
    mp_payment_id: paymentId,
  };

  const { error: insertError } = await supabase
    .from("agenda_turnos")
    .insert(insertPayload);

  if (insertError) {
    delete insertPayload.mp_payment_id;
    const { error: fallbackError } = await supabase.from("agenda_turnos").insert(insertPayload);
    if (fallbackError) {
      console.error("mercadopago-webhook: DB insert error", fallbackError);
    }
  }

  return withCors(JSON.stringify({ received: true }), 200);
  } catch (err) {
    console.error("mercadopago-webhook: unhandled error", err);
    return withCors(
      JSON.stringify({ error: "Internal server error", received: true }),
      500
    );
  }
});
