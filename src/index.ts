import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { InitializationError, RequestError } from "./lib/errors";
import EventEmitter from "events";
import { delay, signPayload, verifySignature } from "./lib/utilits";

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

export class TrustBrokerClient extends EventEmitter {
  private clientId: string;
  private publicKey: string;
  private privateKey: string;
  private http: AxiosInstance;
  private logger?: TrustBrokerClientOptions["logger"];

  constructor(options?: TrustBrokerClientOptions) {
    super();

    // Use default logger or none
    this.logger = options?.logger ?? undefined;

    const { TB_CLIENT_ID, TB_PUBLIC_KEY, TB_PRIVATE_KEY, TB_BROKER_URL } =
      process.env;

    if (!TB_CLIENT_ID || !TB_PUBLIC_KEY || !TB_PRIVATE_KEY) {
      throw new InitializationError("Missing credentials in .env");
    }

    this.clientId = TB_CLIENT_ID;
    this.publicKey = Buffer.from(TB_PUBLIC_KEY, "base64").toString("utf8");
    this.privateKey = Buffer.from(TB_PRIVATE_KEY, "base64").toString("utf8");

    const baseURL = (TB_BROKER_URL || "https://broker.trustbroker.io").replace(
      /\/+$/,
      ""
    );
    this.http = axios.create({ baseURL });

    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      config.headers = config.headers ?? {};
      config.headers["Client-Id"] = this.clientId;
      if (config.data) {
        const signature = signPayload(config.data, this.privateKey);
        config.headers["Signature"] = signature;
      }
      
      return config;
    });
  }

  public getClientId(): string {
    return this.clientId;
  }

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
      this.handleApiError(err, "getMyInstitution");
    }
  }

  public async getPublicKey(): Promise<string> {
    try {
      const { data } = await this.http.get("/system/public-key");
      return data;
    } catch (err) {
      this.handleApiError(err, "getMyInstitution");
    }
  }

  public async createDataRequest(params: {
    providerId: string;
    dataOwnerId: string;
    schemaId: string;
    relationshipId?: string;
    expiresAt?: string;
  }): Promise<{
    requestId: string;
    status: string;
    // any other fields the broker returns
  }> {
    // 1. Build the raw payload
    const payload = {
      requesterId: this.clientId, // your client ID
      providerId: params.providerId,
      dataOwnerId: params.dataOwnerId,
      dataSchemaId: params.schemaId,
      relationshipId: params.relationshipId,
      expiresAt: params.expiresAt,
      signature: "", // placeholder
    };
    const serialized = JSON.stringify({
      ...payload,
      signature: undefined, // sign only the data fields
    });
    payload.signature = signPayload(serialized, this.privateKey);

    try {
      // 4. POST to /requests (or whatever endpoint your broker uses)
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
    // 2. Canonicalize and sign it
    const body = {
      requesterId: this.clientId,
      platformSignature,
      requestId,
      signature: mySignature,
    };

    try {
      // 3. POST to the provider directly
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

  public signPayload(payload: any): string {
    const serialized =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    return signPayload(serialized, this.privateKey);
  }

  /**
   * Verify a signature against a payload using the given public key.
   */
  public verifyPayloadSignature(
    payload: any,
    signature: string,
    publicKey: string
  ): boolean {
    const serialized =
      typeof payload === "string" ? payload : JSON.stringify(payload);
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
