const BASE = "https://www.googleapis.com";

async function apiFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  return res.json();
}

export async function fetchUserInfo(token) {
  return apiFetch(token, `${BASE}/oauth2/v3/userinfo`);
}

export async function fetchCalendars(token) {
  const data = await apiFetch(
    token,
    `${BASE}/calendar/v3/users/me/calendarList?maxResults=250`
  );
  return data.items || [];
}

export async function fetchEvents(token, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: "500",
  });
  const encoded = encodeURIComponent(calendarId);
  const data = await apiFetch(
    token,
    `${BASE}/calendar/v3/calendars/${encoded}/events?${params}`
  );
  return data.items || [];
}

export async function createEvent(token, calendarId, appEvent) {
  const encoded = encodeURIComponent(calendarId);
  const qs = appEvent.addMeet ? "?conferenceDataVersion=1" : "";
  return apiFetch(
    token,
    `${BASE}/calendar/v3/calendars/${encoded}/events${qs}`,
    { method: "POST", body: JSON.stringify(appEventToGoogle(appEvent)) }
  );
}

export async function updateEvent(token, calendarId, googleEventId, appEvent) {
  const encoded = encodeURIComponent(calendarId);
  const qs = appEvent.addMeet ? "?conferenceDataVersion=1" : "";
  return apiFetch(
    token,
    `${BASE}/calendar/v3/calendars/${encoded}/events/${googleEventId}${qs}`,
    { method: "PUT", body: JSON.stringify(appEventToGoogle(appEvent)) }
  );
}

export async function deleteEvent(token, calendarId, googleEventId) {
  const encoded = encodeURIComponent(calendarId);
  const res = await fetch(
    `${BASE}/calendar/v3/calendars/${encoded}/events/${googleEventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok && res.status !== 204 && res.status !== 410) {
    throw new Error(`Delete failed: ${res.status}`);
  }
}

// ── Mappers ──────────────────────────────────────────────────────────────────

export function mapGoogleCalendar(gCal) {
  return {
    id: gCal.id,
    name: gCal.summary || gCal.id,
    color: gCal.backgroundColor || "#2563EB",
    on: gCal.selected !== false,
  };
}

export function mapGoogleEvent(gEvent, calendarId) {
  const start = gEvent.start?.dateTime || gEvent.start?.date;
  const end = gEvent.end?.dateTime || gEvent.end?.date;
  const allDay = !gEvent.start?.dateTime;

  let date, sh = 0, sm = 0, eh = 23, em = 59;
  if (allDay) {
    // "YYYY-MM-DD" format
    const [y, m, d] = start.split("-").map(Number);
    date = new Date(y, m - 1, d);
  } else {
    const startDt = new Date(start);
    const endDt = new Date(end);
    date = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
    sh = startDt.getHours();
    sm = startDt.getMinutes();
    eh = endDt.getHours();
    em = endDt.getMinutes();
  }

  const meetEntry = gEvent.conferenceData?.entryPoints?.find(e => e.entryPointType === "video");
  const videoLink = meetEntry?.uri || gEvent.hangoutLink || "";

  const attendees = (gEvent.attendees || [])
    .filter(a => !a.self)
    .map(a => ({ email: a.email, name: a.displayName || "", status: a.responseStatus || "needsAction" }));

  return {
    id: gEvent.id,
    googleId: gEvent.id,
    title: gEvent.summary || "(Sin título)",
    cid: calendarId,
    date,
    sh, sm, eh, em,
    allDay,
    desc: gEvent.description || "",
    loc: gEvent.location || "",
    videoLink,
    attendees,
  };
}

function appEventToGoogle(appEvent) {
  const conferenceData = appEvent.addMeet ? {
    createRequest: {
      requestId: `maestro-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  } : undefined;

  const attendees = (appEvent.attendees || [])
    .filter(a => a.email?.trim())
    .map(a => ({ email: a.email.trim() }));

  if (appEvent.allDay) {
    const pad = n => String(n).padStart(2, "0");
    const d = appEvent.date;
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return {
      summary: appEvent.title,
      description: appEvent.desc || "",
      location: appEvent.loc || "",
      start: { date: dateStr },
      end: { date: dateStr },
      ...(conferenceData && { conferenceData }),
      ...(attendees.length && { attendees }),
    };
  }
  const startDt = new Date(appEvent.date);
  startDt.setHours(appEvent.sh, appEvent.sm, 0, 0);
  const endDt = new Date(appEvent.date);
  endDt.setHours(appEvent.eh, appEvent.em, 0, 0);
  return {
    summary: appEvent.title,
    description: appEvent.desc || "",
    location: appEvent.loc || "",
    start: { dateTime: startDt.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: endDt.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    ...(conferenceData && { conferenceData }),
    ...(attendees.length && { attendees }),
  };
}
