import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { link_id, guest_name, guest_email, slot_date, slot_sh, slot_sm } = await req.json();

    if (!link_id || !guest_name || !guest_email || !slot_date || slot_sh == null || slot_sm == null) {
      throw new Error("Faltan datos requeridos");
    }

    // Admin client bypasses RLS — can read refresh_token
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Fetch link config (includes refresh_token)
    const { data: link, error: le } = await admin
      .from("booking_links")
      .select("*")
      .eq("id", link_id)
      .single();
    if (le || !link) throw new Error("Link no encontrado");

    // 2. Verify slot is still available (race condition guard)
    const { data: existing } = await admin
      .from("booking_requests")
      .select("id")
      .eq("link_id", link_id)
      .eq("slot_date", slot_date)
      .eq("slot_sh", slot_sh)
      .eq("slot_sm", slot_sm)
      .eq("status", "confirmed");
    if (existing && existing.length > 0) throw new Error("SLOT_TAKEN");

    // 3. Refresh Google access token using stored refresh_token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: link.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error("No se pudo refrescar el token de Google: " + (tokenData.error_description || tokenData.error || ""));
    }
    const access_token = tokenData.access_token;

    // 4. Calculate start/end datetime
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const startDt = new Date(`${slot_date}T${pad2(slot_sh)}:${pad2(slot_sm)}:00`);
    const endDt = new Date(startDt.getTime() + link.duration * 60 * 1000);

    // 5. Build GCal event body
    const gcalBody: Record<string, unknown> = {
      summary: `${link.title} con ${guest_name}`,
      description: `Agendado por ${guest_name} (${guest_email}) via Maestro`,
      start: { dateTime: startDt.toISOString() },
      end: { dateTime: endDt.toISOString() },
      attendees: [{ email: guest_email }],
    };
    if (link.add_video) {
      gcalBody.conferenceData = {
        createRequest: {
          requestId: `bk-${link_id}-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    // 6. Create event in Google Calendar
    const calId = link.target_cal || "primary";
    const qs = link.add_video ? "?conferenceDataVersion=1&sendUpdates=all" : "?sendUpdates=all";
    const evtRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events${qs}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(gcalBody),
      }
    );
    const gEvt = await evtRes.json();
    if (!evtRes.ok) {
      throw new Error(gEvt?.error?.message || `GCal error ${evtRes.status}`);
    }

    const meetLink =
      gEvt.conferenceData?.entryPoints?.find(
        (e: { entryPointType: string; uri: string }) => e.entryPointType === "video"
      )?.uri ||
      gEvt.hangoutLink ||
      "";

    // 7. Record the confirmed booking in Supabase
    const { error: insertErr } = await admin.from("booking_requests").insert({
      link_id,
      guest_name,
      guest_email,
      slot_date,
      slot_sh,
      slot_sm,
      slot_eh: endDt.getHours(),
      slot_em: endDt.getMinutes(),
      status: "confirmed",
      gcal_event_id: gEvt.id,
      meet_link: meetLink,
    });
    if (insertErr) console.error("Insert booking_request error:", insertErr);

    return new Response(
      JSON.stringify({ ok: true, meetLink, eventId: gEvt.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as Error).message || "Error desconocido";
    const status = msg === "SLOT_TAKEN" ? 409 : 500;
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
