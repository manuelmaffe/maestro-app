const SUPABASE_URL = "https://wvylxgthmadqprnbjlrc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWx4Z3RobWFkcXBybmJqbHJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDk1MTksImV4cCI6MjA4NzI4NTUxOX0.ChwJG_8j2DDcOgtYV0KftGMXyfOMQhNuUcYwalsR46E";

export default async function handler(req, res) {
  console.log("suggest-todos called, ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify Supabase JWT — solo usuarios autenticados pueden usar esta función
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  const jwt = authHeader.slice(7);
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { todos, freeSlots } = req.body;
  if (!todos?.length) {
    return res.status(400).json({ ok: false, error: "No todos provided" });
  }

  const todosText = todos
    .map((t, i) =>
      `${i + 1}. "${t.title}" — prioridad: ${t.priority}, duración: ${t.estimated_minutes}min${t.scheduled_date ? `, fecha sugerida: ${t.scheduled_date}` : ""}`
    )
    .join("\n");

  const slots = (freeSlots || []).slice(0, 20);
  const pad = (n) => String(n).padStart(2, "0");
  const slotsText = slots.length
    ? slots
        .map((s) => {
          const dur = s.eh * 60 + s.em - (s.sh * 60 + s.sm);
          return `${s.date} ${pad(s.sh)}:${pad(s.sm)}–${pad(s.eh)}:${pad(s.em)} (${dur}min libres)`;
        })
        .join("\n")
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
- PRIORIZAR días de semana (lunes a viernes). Solo usar sábado/domingo si no hay alternativa entre semana
- AGRUPAR tareas en los mismos días: es preferible poner 2-3 tareas en un mismo día que distribuirlas en días distintos. Buscá días con bloques largos y llenálos antes de pasar al siguiente día
- No superpongas tareas entre sí (respetá la duración estimada de cada una)
- No uses un slot más corto que la duración estimada de la tarea
- Si no hay slot adecuado para una tarea, omitila del array
- La razón debe ser corta (máx 80 chars)`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
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
    const err = await anthropicRes.text();
    console.error("Anthropic error:", err);
    return res.status(500).json({ ok: false, error: `Anthropic error: ${err}` });
  }

  const anthropicData = await anthropicRes.json();
  const rawText = anthropicData.content?.[0]?.text || "[]";

  let suggestions = [];
  try {
    const match = rawText.match(/\[[\s\S]*\]/);
    suggestions = match ? JSON.parse(match[0]) : [];
  } catch {
    suggestions = [];
  }

  return res.json({ ok: true, suggestions });
}
