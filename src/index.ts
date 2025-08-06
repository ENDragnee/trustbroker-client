import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import EventEmitter from "events";
import { 
  InitializationError, 
  RequestError 
} from "./lib/errors";
// We no longer need the real signing functions for the bypass
// import { signPayload, verifySignature } from "./lib/utilits"; 

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

// --- TrustBrokerClient Class (Bypass Version) ---

export class TrustBrokerClient extends EventEmitter {
  private clientId: string;
  // REMOVED: privateKey is not needed in bypass mode.
  // private privateKey: string;
  private http: AxiosInstance;
  private logger?: TrustBrokerClientOptions["logger"];

  constructor(options?: TrustBrokerClientOptions) {
    super();

    this.logger = options?.logger ?? undefined;

    // THE BYPASS: We only need the Client ID and Broker URL. Keys are ignored.
    const { TB_CLIENT_ID, TB_BROKER_URL } = process.env;

    if (!TB_CLIENT_ID) {
      throw new InitializationError("Missing TB_CLIENT_ID in .env for bypass mode");
    }

    this.clientId = TB_CLIENT_ID;
    // REMOVED: No need to load or decode the private key.
    // this.privateKey = Buffer.from(TB_PRIVATE_KEY, "base64").toString("utf8");

    const baseURL = (TB_BROKER_URL || "https://broker.trustbroker.io").replace(/\/+$/, "");
    this.http = axios.create({ baseURL });

    // THE BYPASS: The interceptor now only adds the Client-Id.
    // All signature logic has been removed.
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      config.headers = config.headers ?? {};
      config.headers["Client-Id"] = this.clientId;
      
      // The `Signature` header is no longer added.
      
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
    const payload = {
      providerId: params.providerId,
      dataOwnerId: params.dataOwnerId,
      schemaId: params.schemaId,
      expiresIn: params.expiresIn || 3600,
    };

    try {
      // The interceptor will add the Client-Id header. No signature is sent.
      // This will work because the backend `m2m-auth` middleware is also in bypass mode.
      const { data } = await this.http.post("/requests", payload);
      return data;
    } catch (err) {
      this.handleApiError(err, "createDataRequest");
    }
  }

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
    const body = {
      requesterId: this.clientId,
      platformSignature,
      requestId,
      signature: mySignature, // This signature is for provider auth, not broker auth
    };

    try {
      const { data } = await axios.post<ProviderDataResponse>(
        providerEndpoint, body, { headers: { "Content-Type": "application/json" } }
      );
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        throw new RequestError("PROVIDER_ERROR", `requestDataFromProvider: ${err.response.data?.error || err.message}`);
      }
      throw new RequestError("UNKNOWN", `requestDataFromProvider: ${(err as Error).message}`);
    }
  }

  public async submitRequesterSignature(
    requestId: string,
    providerId: string,
    providerSignature: string,
    platformSignature: string,
    requesterSignature: string
  ): Promise<CompleteRequestResponse> {
    const body = {
      providerId,
      providerSignature,
      platformSignature,
      requesterSignature,
    };

    try {
      const { data } = await this.http.post<CompleteRequestResponse>(
        `/requests/${requestId}/requester-signature`, body
      );
      return data;
    } catch (err) {
      this.handleApiError(err, "submitRequesterSignature");
    }
  }

  // --- Utility methods are now just placeholders in bypass mode ---
  
  public signPayload(payload: any): string {
    console.warn("SDK WARNING: signPayload called in bypass mode. Returning dummy signature.");
    return "dummy-signature-bypassed";
  }

  public verifyPayloadSignature(
    payload: any,
    signature: string,
    publicKey: string
  ): boolean {
    console.warn("SDK WARNING: verifyPayloadSignature called in bypass mode. Always returning true.");
    return true;
  }

  private handleApiError(err: unknown, context: string): never {
    if (axios.isAxiosError(err) && err.response) {
      const msg = err.response.data?.error || err.message;
      throw new RequestError("API_ERROR", `${context}: ${msg}`);
    }
    throw new RequestError("UNKNOWN", `${context}: ${(err as Error).message}`);
  }
}
