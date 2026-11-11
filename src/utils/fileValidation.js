const ALLOWED_EXTENSIONS = ["PDF", "PPT", "PPTX"];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const EXTENSION_MIME_MAP = {
  PDF: "application/pdf",
  PPT: "application/vnd.ms-powerpoint",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

export function normalizeSubjectName(rawName) {
  return String(rawName || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function getCanonicalMimeType(extension) {
  const ext = String(extension || "").toUpperCase();
  return EXTENSION_MIME_MAP[ext] || "application/octet-stream";
}

export function inspectMagicBytes(bytes, extension) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return { valid: false, reason: "File is empty or too small to verify." };
  }

  // Always block executable / script headers regardless of extension
  const asciiPrefix = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 16))).toLowerCase();
  if (
    (bytes[0] === 0x4d && bytes[1] === 0x5a) || // Windows PE 'MZ'
    (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) || // ELF
    asciiPrefix.startsWith("<!doctype html") ||
    asciiPrefix.startsWith("<html") ||
    asciiPrefix.startsWith("<script")
  ) {
    return {
      valid: false,
      reason: "Executable or HTML/script content is not permitted."
    };
  }

  const ext = String(extension || "").toUpperCase();

  if (ext === "PDF") {
    // %PDF- (25 50 44 46 2D)
    const isPdf =
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46;
    return isPdf
      ? { valid: true }
      : { valid: false, reason: "The selected file does not have a valid PDF header (%PDF)." };
  }

  if (ext === "PPTX") {
    // PK\x03\x04 (50 4B 03 04)
    const isZip =
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
    return isZip
      ? { valid: true }
      : { valid: false, reason: "The selected PPTX file is not a valid OpenXML ZIP archive." };
  }

  if (ext === "PPT") {
    // OLE2 Compound Document (D0 CF 11 E0 A1 B1 1A E1)
    const isOle =
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0;
    return isOle
      ? { valid: true }
      : { valid: false, reason: "The selected PPT file does not have a valid PowerPoint binary header." };
  }

  return { valid: false, reason: "Unsupported file format." };
}

export async function readHeaderBytes(blobOrFile, length = 16) {
  if (!blobOrFile) return null;

  try {
    const slice =
      typeof blobOrFile.slice === "function"
        ? blobOrFile.slice(0, length)
        : blobOrFile;

    if (typeof slice.arrayBuffer === "function") {
      const buffer = await slice.arrayBuffer();
      return new Uint8Array(buffer);
    }

    if (typeof FileReader !== "undefined") {
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(
            reader.result instanceof ArrayBuffer
              ? new Uint8Array(reader.result)
              : null
          );
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(slice);
      });
    }
  } catch (_err) {
    return null;
  }

  return null;
}

export async function validateUploadFile(file) {
  if (!file) {
    return { valid: false, error: "Please select a file to upload." };
  }

  const nameParts = String(file.name || "").split(".");
  const extension = nameParts.length > 1 ? nameParts.pop().toUpperCase() : "";

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      error: "Please select a PDF, PPT, or PPTX file."
    };
  }

  if (typeof file.size === "number") {
    if (file.size <= 0) {
      return { valid: false, error: "The selected file is empty." };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: "Please select a file smaller than 20 MB."
      };
    }
  }

  const headerBytes = await readHeaderBytes(file, 16);
  if (headerBytes && headerBytes.length >= 4) {
    const magicResult = inspectMagicBytes(headerBytes, extension);
    if (!magicResult.valid) {
      return { valid: false, error: magicResult.reason };
    }
  }

  return {
    valid: true,
    extension,
    mimeType: getCanonicalMimeType(extension)
  };
}
