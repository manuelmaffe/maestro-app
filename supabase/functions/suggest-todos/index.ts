const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { todos, freeSlots } = await req.json();
    if (!todos?.length) throw new Error("No todos provided");

    // Build prompt
    const todosText = todos.map((t: {title:string;priority:string;estimated_minutes:number;scheduled_date?:string}, i: number) =>
      `${i+1}. "${t.title}" — prioridad: ${t.priority}, duración estimada: ${t.estimated_minutes}min${t.scheduled_date ? `, fecha sugerida: ${t.scheduled_date}` : ""}`
    ).join("\n");

    const slots = (freeSlots || []).slice(0, 20);
    const slotsText = slots.length
      ? slots.map((s: {date:string;sh:number;sm:number;eh:number;em:number}) => {
          const fmt = (h: number, m: number) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
          const dur = (s.eh * 60 + s.em) - (s.sh * 60 + s.sm);
          return `${s.date} ${fmt(s.sh, s.sm)}–${fmt(s.eh, s.em)} (${dur}min libres)`;
        }).join("\n")
      : "No hay slots disponibles";

    const prompt = `Eres un asistente de productividad. El usuario tiene las siguientes tareas pendientes:

${todosText}

Y estos bloques de tiempo libre en su calendario (próximos 7 días):

${slotsText}

Tu tarea: asignar cada tarea pendiente al bloque de tiempo libre más adecuado, respetando la prioridad y la duración estimada. Responde SOLO con un JSON array con este formato exacto, sin texto extra:

[
  {
    "todo_index": 0,
    "date": "YYYY-MM-DD",
    "sh": 9,
    "sm": 0,
    "reason": "breve explicación en español"
  }
]

Reglas:
- todo_index es el índice (base 0) de la tarea en la lista original
- Asigná las tareas de mayor prioridad primero (urgent > high > medium > low)
- No superpongas tareas entre sí
- No uses un slot más corto que la duración estimada de la tarea
- Si no hay slot adecuado para una tarea, omitila del array
- La razón debe ser corta (máx 80 chars)`;

    // Call Anthropic API
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      throw new Error(`Anthropic error: ${errBody}`);
    }

    const anthropicData = await anthropicRes.json();
    const rawText = anthropicData.content?.[0]?.text || "[]";

    // Parse JSON from response
    let suggestions: unknown[] = [];
    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      suggestions = match ? JSON.parse(match[0]) : [];
    } catch {
      suggestions = [];
    }

    return new Response(
      JSON.stringify({ ok: true, suggestions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as Error).message;
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
