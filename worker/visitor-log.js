/**
 * Cloudflare Worker — visitor notification + IP logging
 *
 * Required secrets:
 *   RESEND_API_KEY
 *   ALERT_EMAIL
 *
 * Deploy this Worker separately from GitHub Pages.
 * Configure ALLOWED_ORIGIN to https://ajaysahani.com.np
 *
 * The worker receives only a visitor event after the site's
 * visitor notice/consent flow and records the request IP
 * server-side. It does not request camera/location access.
 */
const ALLOWED_ORIGIN = "https://ajaysahani.com.np";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403, headers: cors });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: cors });
    }

    if (body?.event !== "page_visit") {
      return new Response("Invalid event", { status: 400, headers: cors });
    }

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      "unknown";

    const timestamp = new Date().toISOString();
    const userAgent = request.headers.get("User-Agent") || "unknown";
    const country = request.headers.get("CF-IPCountry") || "unknown";

    const record = {
      timestamp,
      ip,
      ipVersion: ip.includes(":") ? "IPv6" : "IPv4",
      country,
      path: typeof body.path === "string" ? body.path.slice(0, 300) : "/",
      referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 500) : "",
      userAgent: userAgent.slice(0, 1000)
    };

    // Send the alert through Resend. Keep the API key only in Worker secrets.
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "Website Visitor <onboarding@resend.dev>",
        to: [env.ALERT_EMAIL],
        subject: `Website visit — ${record.ipVersion}`,
        text:
          `New visit to ajaysahani.com.np\\n\\n` +
          `Time: ${record.timestamp}\\n` +
          `IP: ${record.ip} (${record.ipVersion})\\n` +
          `Country: ${record.country}\\n` +
          `Path: ${record.path}\\n` +
          `Referrer: ${record.referrer || "Direct"}\\n` +
          `User-Agent: ${record.userAgent}`
      })
    });

    if (!emailResponse.ok) {
      return new Response("Notification service error", { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({
      ok: true,
      ipVersion: record.ipVersion
    }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};
