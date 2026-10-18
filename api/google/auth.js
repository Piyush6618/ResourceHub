
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

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !supabaseUrl
  ) {
    return res.status(500).send("Server configuration is incomplete");
  }

  const authorization = req.headers.authorization || "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!accessToken) {
    return res.status(401).send("Please sign in to ResourceHub first");
  }

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      return res.status(401).send("Your ResourceHub session is invalid");
    }

    const user = await userResponse.json();

    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!profileResponse.ok) {
      return res.status(500).send("Could not verify your ResourceHub role");
    }

    const profiles = await profileResponse.json();

    if (!profiles.length || profiles[0].role !== "facilitator") {
      return res.status(403).send("Only facilitators can connect Google Drive");
    }

    const oauth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const nonce = crypto.randomBytes(32).toString("hex");
    const payload = Buffer.from(
      JSON.stringify({ userId: user.id, nonce })
    ).toString("base64url");

    const signature = crypto
      .createHmac("sha256", GOOGLE_CLIENT_SECRET)
      .update(payload)
      .digest("hex");

    res.setHeader(
      "Set-Cookie",
      `google_oauth_state=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/api/google; Max-Age=600`
    );

    const url = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state: nonce
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ url });
  } catch (error) {
    console.error("Google authorization setup failed:", error.message);
    return res.status(500).send("Could not start Google authorization");
  }
};
