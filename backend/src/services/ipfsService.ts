import FormData from "form-data";
import axios, { AxiosError } from "axios";

// Configuration
const PINATA_API_URL = process.env.PINATA_API_URL || "https://api.pinata.cloud";
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

// File upload limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
export const MAX_FILES_PER_PROFILE = 5;
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export interface IPFSUploadResult {
  cid: string;
  size: number;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
}

export interface IPFSMessageUploadResult {
  cid: string;
  size: number;
  uploadedAt: string;
}

export interface PortfolioFile {
  cid: string;
  fileName: string;
  mimeType: string;
  size?: number;
  uploadedAt: string;
}

export interface MessagePayload {
  jobId: string;
  senderAddress: string;
  recipientAddress: string;
  content?: string;
  encrypted?: string;
}

interface CustomError extends Error {
  status?: number;
  code?: string;
}

export async function uploadFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<IPFSUploadResult> {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    const e = new Error(
      "IPFS upload service is temporarily unavailable. Please try again later."
    ) as CustomError;
    e.status = 503;
    e.code = "PINATA_NOT_CONFIGURED";
    throw e;
  }

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`File type ${mimeType} not allowed`);
  }

  try {
    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: fileName,
      contentType: mimeType,
    });

    // Add Pinata metadata
    const metadata = {
      name: fileName,
      keyvalues: {
        app: "stellar-marketpay",
        uploadedAt: new Date().toISOString(),
      },
    };

    formData.append("pinataMetadata", JSON.stringify(metadata));

    const response = await axios.post(`${PINATA_API_URL}/pinning/pinFileToIPFS`, formData, {
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET_KEY,
        ...formData.getHeaders(),
      },
      maxContentLength: MAX_FILE_SIZE + 1024, // Add some buffer
      timeout: 30000, // 30 seconds timeout
    });

    if (!response.data.IpfsHash) {
      throw new Error("Invalid response from Pinata");
    }

    return {
      cid: response.data.IpfsHash,
      size: fileBuffer.length,
      fileName: fileName,
      mimeType: mimeType,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("IPFS upload error:", error.response?.data || error.message);

    // Handle specific error cases
    if (error.response?.status === 429) {
      const e = new Error(
        "Upload service rate limit exceeded. Please try again in a few minutes."
      ) as CustomError;
      e.status = 503;
      e.code = "RATE_LIMIT_EXCEEDED";
      throw e;
    }

    if (error.response?.status === 401 || error.response?.status === 403) {
      const e = new Error(
        "IPFS upload service is temporarily unavailable due to authentication issues. Please contact support."
      ) as CustomError;
      e.status = 503;
      e.code = "PINATA_AUTH_FAILED";
      throw e;
    }

    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
      const e = new Error(
        "IPFS upload service is temporarily unavailable. Please try again later."
      ) as CustomError;
      e.status = 503;
      e.code = "PINATA_UNAVAILABLE";
      throw e;
    }

    const e = new Error(`Failed to upload file to IPFS: ${error.message}`) as CustomError;
    e.status = 503;
    e.code = "IPFS_UPLOAD_FAILED";
    throw e;
  }
}

export function validatePortfolioFiles(portfolioFiles: any[]): PortfolioFile[] {
  if (!portfolioFiles) return [];

  if (!Array.isArray(portfolioFiles)) {
    const e = new Error("portfolio_files must be an array") as CustomError;
    e.status = 400;
    throw e;
  }

  if (portfolioFiles.length > MAX_FILES_PER_PROFILE) {
    const e = new Error(
      `Maximum ${MAX_FILES_PER_PROFILE} files allowed per profile`
    ) as CustomError;
    e.status = 400;
    throw e;
  }

  return portfolioFiles.map((file, index) => {
    if (!file || typeof file !== "object") {
      const e = new Error(`Invalid file object at index ${index}`) as CustomError;
      e.status = 400;
      throw e;
    }

    if (!file.cid || typeof file.cid !== "string") {
      const e = new Error(`File at index ${index} missing valid CID`) as CustomError;
      e.status = 400;
      throw e;
    }

    if (!file.fileName || typeof file.fileName !== "string") {
      const e = new Error(`File at index ${index} missing fileName`) as CustomError;
      e.status = 400;
      throw e;
    }

    if (!file.mimeType || typeof file.mimeType !== "string") {
      const e = new Error(`File at index ${index} missing mimeType`) as CustomError;
      e.status = 400;
      throw e;
    }

    if (!file.uploadedAt || typeof file.uploadedAt !== "string") {
      const e = new Error(`File at index ${index} missing uploadedAt`) as CustomError;
      e.status = 400;
      throw e;
    }

    return {
      cid: file.cid.trim(),
      fileName: file.fileName.trim(),
      mimeType: file.mimeType.trim(),
      size: file.size || 0,
      uploadedAt: file.uploadedAt,
    };
  });
}

export function getGatewayUrl(cid: string): string {
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

export async function uploadMessage(
  messagePayload: MessagePayload
): Promise<IPFSMessageUploadResult> {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    const e = new Error(
      "IPFS upload service is temporarily unavailable. Please try again later."
    ) as CustomError;
    e.status = 503;
    e.code = "PINATA_NOT_CONFIGURED";
    throw e;
  }

  const jsonStr = JSON.stringify(messagePayload);
  const buffer = Buffer.from(jsonStr, "utf8");

  try {
    const formData = new FormData();
    formData.append("file", buffer, {
      filename: `msg-${messagePayload.jobId}-${Date.now()}.json`,
      contentType: "application/json",
    });

    const metadata = {
      name: `message-${messagePayload.jobId}`,
      keyvalues: {
        app: "stellar-marketpay",
        type: "message",
        jobId: messagePayload.jobId,
        uploadedAt: new Date().toISOString(),
      },
    };
    formData.append("pinataMetadata", JSON.stringify(metadata));

    const response = await axios.post(`${PINATA_API_URL}/pinning/pinFileToIPFS`, formData, {
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET_KEY,
        ...formData.getHeaders(),
      },
      maxContentLength: 1024 * 1024, // 1MB for messages
      timeout: 15000,
    });

    if (!response.data.IpfsHash) {
      throw new Error("Invalid response from Pinata");
    }

    return {
      cid: response.data.IpfsHash,
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("IPFS message upload error:", error.response?.data || error.message);

    if (error.response?.status === 429) {
      const e = new Error(
        "Upload service rate limit exceeded. Please try again in a few minutes."
      ) as CustomError;
      e.status = 503;
      e.code = "RATE_LIMIT_EXCEEDED";
      throw e;
    }

    if (error.response?.status === 401 || error.response?.status === 403) {
      const e = new Error(
        "IPFS upload service is temporarily unavailable due to authentication issues."
      ) as CustomError;
      e.status = 503;
      e.code = "PINATA_AUTH_FAILED";
      throw e;
    }

    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
      const e = new Error(
        "IPFS upload service is temporarily unavailable. Please try again later."
      ) as CustomError;
      e.status = 503;
      e.code = "PINATA_UNAVAILABLE";
      throw e;
    }

    const e = new Error(`Failed to upload message to IPFS: ${error.message}`) as CustomError;
    e.status = 503;
    e.code = "IPFS_UPLOAD_FAILED";
    throw e;
  }
}

export function isConfigured(): boolean {
  return !!(PINATA_API_KEY && PINATA_SECRET_KEY);
}
