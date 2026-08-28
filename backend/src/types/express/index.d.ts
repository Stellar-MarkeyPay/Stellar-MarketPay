import { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      logger?: Logger;
      user?: {
        publicKey: string;
        role?: string;
        [key: string]: any;
      };
      clientIp?: string;
      apiKey?: any;
    }
  }
  interface Error {
    status?: number;
    statusCode?: number;
    code?: string;
  }
}
