
const { google } = require("googleapis");
const { Readable } = require("stream");

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
  const userAccessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  const resourceId = req.query.id;

  if (!userAccessToken || !resourceId || typeof resourceId !== "string") {
    return res.status(401).send("Sign in and select a resource first");
  }

  let drive;
  let temporaryFileId;

  try {
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    };

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${userAccessToken}`
      }
    });

    if (!userResponse.ok) {
      return res.status(401).send("Your session has expired");
    }

    const user = await userResponse.json();

    const resourceResponse = await fetch(
      `${supabaseUrl}/rest/v1/resources?id=eq.${encodeURIComponent(resourceId)}&select=id,title,file_name,file_path,file_type,owner_id`,
      { headers }
    );

    if (!resourceResponse.ok) {
      return res.status(500).send("Could not check the resource");
    }

    const resources = await resourceResponse.json();
    const resource = resources[0];

    if (!resource) {
      return res.status(404).send("Resource not found");
    }

    const type = String(resource.file_type || "").toUpperCase();

    if (!["PPT", "PPTX"].includes(type)) {
      return res.status(400).send("Only PPT and PPTX files use this preview");
    }

    const tokenResponse = await fetch(
      `${supabaseUrl}/rest/v1/google_drive_tokens?user_id=eq.${encodeURIComponent(resource.owner_id)}&select=access_token,refresh_token,expiry_date`,
      { headers }
    );

    if (!tokenResponse.ok) {
      return res.status(500).send("Could not check Google authorization");
    }

    const tokenRows = await tokenResponse.json();
    const savedTokens = tokenRows[0];

    if (!savedTokens || !savedTokens.refresh_token) {
      return res.status(409).send(
        "The facilitator must connect Google Drive before this file can be previewed."
      );
    }

    const oauth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth.setCredentials({
      access_token: savedTokens.access_token,
      refresh_token: savedTokens.refresh_token,
      expiry_date: savedTokens.expiry_date
    });

    drive = google.drive({ version: "v3", auth: oauth });

    const filePath = String(resource.file_path || "");

    if (
      !filePath ||
      filePath.startsWith("/") ||
      filePath.split("/").some((part) => part === "..")
    ) {
      return res.status(400).send("Invalid resource file path");
    }

    const encodedPath = filePath
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const fileResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/resources/${encodedPath}`,
      { headers }
    );

    if (!fileResponse.ok) {
      return res.status(502).send("Could not retrieve the private resource");
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

    const mimeType = type === "PPT"
      ? "application/vnd.ms-powerpoint"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    const converted = await drive.files.create({
      requestBody: {
        name: `ResourceHub preview ${resource.id}`,
        mimeType: "application/vnd.google-apps.presentation"
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer)
      },
      fields: "id"
    });

    temporaryFileId = converted.data.id;

    if (!temporaryFileId) {
      throw new Error("Google did not return a converted file ID");
    }

    const pdf = await drive.files.export(
      {
        fileId: temporaryFileId,
        mimeType: "application/pdf"
      },
      { responseType: "arraybuffer" }
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="resource-preview.pdf"'
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(Buffer.from(pdf.data));
  } catch (error) {
    console.error("Presentation preview failed:", error.message);

    if (!res.headersSent) {
      return res.status(502).send(
        "Could not convert this presentation. Please try downloading it."
      );
    }
  } finally {
    if (drive && temporaryFileId) {
      try {
        await drive.files.delete({ fileId: temporaryFileId });
      } catch (error) {
        console.error("Temporary Google file cleanup failed");
      }
    }
  }
};
