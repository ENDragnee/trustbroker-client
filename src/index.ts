import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import EventEmitter from "events";
// Assuming you have these in a file named `lib/utilits.ts`
import { 
  InitializationError, 
  RequestError 
} from "./lib/errors";
import { 
  delay, 
  signPayload, 
  verifySignature 
} from "./lib/utilits"; 

// --- Interfaces ---

export interface RequestDataParams {
  ownerExternalId: string;
  providerId: string;
  schemaId: string;
  neededData?: any;
  pollingIntervalMs?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface RequestStatusResponse {
  requestId: string;
  status: string;
  platformSignature?: string;
  providerEndpoint?: string;
}

export interface ProviderDataResponse {
  signature: string;
  requestId: string;
  data: any;
}

export interface CompleteRequestResponse {
  requestId: string;
  status: string; // e.g. "COMPLETED"
}

export interface TrustBrokerClientOptions {
  logger?: {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
}

// --- TrustBrokerClient Class ---

export class TrustBrokerClient extends EventEmitter {
  private clientId: string;
  private privateKey: string;
  private http: AxiosInstance;
  private logger?: TrustBrokerClientOptions["logger"];

  constructor(options?: TrustBrokerClientOptions) {
    super();

    this.logger = options?.logger ?? undefined;

    const { TB_CLIENT_ID, TB_PRIVATE_KEY, TB_BROKER_URL } = process.env;

    if (!TB_CLIENT_ID || !TB_PRIVATE_KEY) {
      throw new InitializationError("Missing credentials in .env");
    }

    this.clientId = TB_CLIENT_ID;
    // The private key from .env is Base64 encoded; decode it to PEM string
    this.privateKey = Buffer.from(TB_PRIVATE_KEY, "base64").toString("utf8");

    const baseURL = (TB_BROKER_URL || "https://broker.trustbroker.io").replace(/\/+$/, "");
    this.http = axios.create({ baseURL });

    // Axios Interceptor for M2M Authentication
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      config.headers = config.headers ?? {};
      config.headers["Client-Id"] = this.clientId;
      
      // If the request has a body, sign it and add the signature header.
      if (config.data) {
        // This relies on the `signPayload` function in `lib/utilits.ts`
        const signature = signPayload(config.data, this.privateKey);
        config.headers["Signature"] = signature;
      }
      
      return config;
    });
  }

  public getClientId(): string {
    return this.clientId;
  }

  // --- API Methods ---

  public async getMyInstitution(): Promise<any> {
    try {
      const { data } = await this.http.get("/institution/me");
      return data;
    } catch (err) {
      this.handleApiError(err, "getMyInstitution");
    }
  }

  public async getInstitutionById(id: string): Promise<any> {
    try {
      const { data } = await this.http.get("/institution/" + id);
      return data;
    } catch (err) {
      this.handleApiError(err, "getInstitutionById");
    }
  }

  public async getPublicKey(): Promise<string> {
    try {
      // This is the platform's public key, if needed for verification purposes
      const { data } = await this.http.get("/system/public-key");
      return data;
    } catch (err) {
      this.handleApiError(err, "getPublicKey");
    }
  }

  /**
   * Initiates a new data request with the Trust Broker.
   */
  public async createDataRequest(params: {
    providerId: string;
    dataOwnerId: string;
    schemaId: string;
    expiresIn?: number;
  }): Promise<{
    requestId: string;
    status: string;
  }> {
    // Construct the clean payload object
    const payload = {
      providerId: params.providerId,
      dataOwnerId: params.dataOwnerId,
      schemaId: params.schemaId,
      expiresIn: params.expiresIn || 3600,
    };

    try {
      // The interceptor handles signing this payload and adding the headers.
      const { data } = await this.http.post("/requests", payload);
      return data;
    } catch (err) {
      this.handleApiError(err, "createDataRequest");
    }
  }

  /**
   * Get status of a specific data request.
   */
  public async getRequestStatus(
    requestId: string
  ): Promise<RequestStatusResponse> {
    try {
      const { data } = await this.http.get(`/requests/${requestId}`);
      return data;
    } catch (err) {
      this.handleApiError(err, "getRequestStatus");
    }
  }

  public async requestDataFromProvider(
    requestId: string,
    platformSignature: string,
    mySignature: string,
    providerEndpoint: string
  ): Promise<ProviderDataResponse> {
    // The body for the request to the provider
    const body = {
      requesterId: this.clientId,
      platformSignature,
      requestId,
      signature: mySignature,
    };

    try {
      // POST to the provider directly (not via the broker's HTTP instance)
      const { data } = await axios.post<ProviderDataResponse>(
        providerEndpoint,
        body,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        throw new RequestError(
          "PROVIDER_ERROR",
          `requestDataFromProvider: ${err.response.data?.error || err.message}`
        );
      }
      throw new RequestError(
        "UNKNOWN",
        `requestDataFromProvider: ${(err as Error).message}`
      );
    }
  }

  public async submitRequesterSignature(
    requestId: string,
    providerId: string,
    providerSignature: string,
    platformSignature: string,
    requesterSignature: string
  ): Promise<CompleteRequestResponse> {
    // The body for the broker's endpoint
    const body = {
      providerId,
      providerSignature,
      platformSignature,
      requesterSignature,
    };

    try {
      const { data } = await this.http.post<CompleteRequestResponse>(
        `/requests/${requestId}/requester-signature`,
        body
      );
      return data;
    } catch (err) {
      this.handleApiError(err, "submitRequesterSignature");
    }
  }

  /**
   * Utility method to sign a payload (used internally by the interceptor).
   */
  public signPayload(payload: any): string {
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    return signPayload(serialized, this.privateKey);
  }

  /**
   * Utility method to verify a signature (used internally or by clients).
   */
  public verifyPayloadSignature(
    payload: any,
    signature: string,
    publicKey: string
  ): boolean {
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    // This relies on the `verifySignature` in `lib/utilits.ts`
    return verifySignature(serialized, signature, publicKey);
  }

  private handleApiError(err: unknown, context: string): never {
    if (axios.isAxiosError(err) && err.response) {
      const msg = err.response.data?.error || err.message;
      throw new RequestError("API_ERROR", `${context}: ${msg}`);
    }
    throw new RequestError("UNKNOWN", `${context}: ${(err as Error).message}`);
  }
}
