// create-preference — Booking Engine: preferencia de pago (seña) en Mercado Pago
// Supabase Edge Function (Deno) — Senior Backend Engineer

import { createClient } from "supabase";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MP_PREFERENCES_URL = "https://api.mercadopago.com/checkout/preferences";
const EXTERNAL_REF_MAX_LEN = 256;

type ClientData = {
  nombre?: string;
  apellido?: string;
  email?: string;
  telefono?: string;
  [key: string]: unknown;
};

type RequestBody = {
  professional_id: string;
  service_item_id: string;
  date: string;
  time: string;
  client_data: ClientData;
};

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido. Use POST." }, 405);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Cuerpo JSON inválido." }, 400);
  }

  const { professional_id, service_item_id, date, time, client_data } = body;
  if (!professional_id || !service_item_id || !date || !time || !client_data) {
    return jsonResponse(
      {
        error:
          "Faltan campos: professional_id, service_item_id, date, time, client_data.",
      },
      400
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1) Obtener monto_sena desde servicios_items (nunca confiar en el frontend)
  const { data: item, error: itemError } = await supabase
    .from("servicios_items")
    .select("monto_sena, nombre")
    .eq("id", service_item_id)
    .single();

  if (itemError || !item) {
    return jsonResponse(
      { error: "Servicio no encontrado." },
      404
    );
  }

  const montoSena = Number(item.monto_sena ?? 0);
  if (montoSena <= 0) {
    return jsonResponse(
      { error: "Este servicio no tiene monto de seña configurado." },
      400
    );
  }

  const itemTitle = (item.nombre as string) || "Seña - Reserva";

  // 2) external_reference: JSON con datos de la reserva (para el webhook)
  const reservationPayload = {
    professional_id,
    service_item_id,
    date,
    time,
    client_data: {
      nombre: client_data.nombre,
      apellido: client_data.apellido,
      email: client_data.email,
      telefono: client_data.telefono,
    },
  };
  let externalRef = JSON.stringify(reservationPayload);
  if (externalRef.length > EXTERNAL_REF_MAX_LEN) {
    externalRef = externalRef.slice(0, EXTERNAL_REF_MAX_LEN - 3) + "...";
  }

  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!mpToken) {
    return jsonResponse(
      { error: "MP_ACCESS_TOKEN no configurado." },
      500
    );
  }

  // 3) Crear preferencia en Mercado Pago (REST API)
  const backUrlBase =
    Deno.env.get("BOOKING_BACK_URL_BASE") || "https://tu-sitio.com";
  const preferenceBody = {
    items: [
      {
        title: itemTitle,
        quantity: 1,
        unit_price: montoSena,
        currency_id: "ARS",
      },
    ],
    back_urls: {
      success: `${backUrlBase}/booking/success`,
      failure: `${backUrlBase}/booking/failure`,
      pending: `${backUrlBase}/booking/pending`,
    },
    auto_return: "approved" as const,
    external_reference: externalRef,
    notification_url: Deno.env.get("MP_WEBHOOK_URL") || undefined,
  };

  const mpRes = await fetch(MP_PREFERENCES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mpToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preferenceBody),
  });

  if (!mpRes.ok) {
    const errText = await mpRes.text();
    console.error("Mercado Pago error:", mpRes.status, errText);
    return jsonResponse(
      {
        error: "Error al crear la preferencia de pago.",
        details: mpRes.status,
      },
      502
    );
  }

  const preference = (await mpRes.json()) as { init_point?: string; id?: string };
  const initPoint = preference.init_point;

  if (!initPoint) {
    return jsonResponse(
      { error: "Mercado Pago no devolvió init_point." },
      502
    );
  }

  return jsonResponse(
    {
      init_point: initPoint,
      preference_id: preference.id,
    },
    200
  );
});
