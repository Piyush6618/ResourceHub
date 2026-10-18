
const { google } = require("googleapis");
const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    SUPABASE_SERVICE_ROLE_KEY
  } = process.env;

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL;

  const clearCookie =
    "google_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/google; Max-Age=0";

  function fail(message, status = 400) {
    res.setHeader("Set-Cookie", clearCookie);
    return res.status(status).send(message);
  }

  const { code, state, error } = req.query;

  if (error) {
    return fail("Google authorization was cancelled.");
  }

  if (
    !code ||
    typeof code !== "string" ||
    !state ||
    typeof state !== "string"
  ) {
    return fail("Missing Google authorization details.");
  }

  const cookies = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim());

  const stateCookie = cookies.find((part) =>
    part.startsWith("google_oauth_state=")
  );

  if (!stateCookie) {
    return fail("Authorization expired. Please try again.");
  }

  try {
    const signedState = decodeURIComponent(
      stateCookie.substring("google_oauth_state=".length)
    );

    const parts = signedState.split(".");

    if (parts.length !== 2) {
      return fail("Invalid authorization state.");
    }

    const [payload, signature] = parts;

    const expectedSignature = crypto
      .createHmac("sha256", GOOGLE_CLIENT_SECRET)
      .update(payload)
      .digest("hex");

    const actualBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return fail("Invalid authorization signature.");
    }

    const savedState = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (!savedState.userId || savedState.nonce !== state) {
      return fail("Authorization state did not match.");
    }

    const oauth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth.getToken(code);

    if (!tokens.refresh_token) {
      return fail(
        "Google did not return a refresh token. Please reconnect and grant access."
      );
    }

    const tokenResponse = await fetch(
      `${supabaseUrl}/rest/v1/google_drive_tokens?on_conflict=user_id`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          user_id: savedState.userId,
          access_token: tokens.access_token || null,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date || null
        })
      }
    );

    if (!tokenResponse.ok) {
      console.error("Google token storage failed:", tokenResponse.status);
      return fail("Could not securely save Google authorization.", 500);
    }

    res.setHeader("Set-Cookie", clearCookie);
    res.setHeader("Cache-Control", "no-store");

    return res.redirect(303, "/?google_connected=1");
  } catch (err) {
    console.error("Google callback failed:", err.message);
    return fail("Google authorization failed. Please try again.", 500);
  }
};
