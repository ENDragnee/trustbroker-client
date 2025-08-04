import path from 'path';
import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import {
  KeyObject,
  createPrivateKey,
  createPublicKey,
} from 'crypto';
import dotenv from 'dotenv';
import {
  InitializationError,
  RequestError,
} from './lib/errors';
import EventEmitter from 'events';
import { canonicalizeBody, delay, signPayload } from './lib/utilits';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface RequestDataParams {
  ownerExternalId: string;
  providerId: string;
  schemaId: string;
  neededData?: any;
  pollingIntervalMs?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
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
  private publicKey: KeyObject;
  private privateKey: KeyObject;
  private http: AxiosInstance;
  private logger?: TrustBrokerClientOptions['logger'];

  constructor(options: TrustBrokerClientOptions = {}) {
    super();
    this.logger = options.logger;

    const { TB_CLIENT_ID, TB_PUBLIC_KEY, TB_PRIVATE_KEY, TB_BROKER_URL } = process.env;
    if (!TB_CLIENT_ID || !TB_PUBLIC_KEY || !TB_PRIVATE_KEY) {
      throw new InitializationError('Missing credentials in .env');
    }
    this.clientId = TB_CLIENT_ID;
    this.publicKey = createPublicKey(TB_PUBLIC_KEY);
    this.privateKey = createPrivateKey(TB_PRIVATE_KEY);
    const baseURL = (TB_BROKER_URL || 'https://broker.trustbroker.io').replace(/\/+$/, '');

    this.http = axios.create({ baseURL });
    // Correctly type the interceptor to use InternalAxiosRequestConfig
    this.http = axios.create({ baseURL });
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      config.headers = config.headers ?? {};
      // Always attach Client-Id header
      config.headers['Client-Id'] = this.clientId;
      const signature = signPayload(this.privateKey, this.clientId);
      config.headers['Signature'] = signature;

      return config;
    });
  }

  /**
   * Initiate a new data request.
   */
  public async initiateRequest(
    params: Omit<RequestDataParams, 'pollingIntervalMs' | 'timeoutMs' | 'abortSignal'>
  ): Promise<{ requestId: string }> {
    try {
      const { data } = await this.http.post('/requests', params);
      return data;
    } catch (err) {
      this.handleApiError(err, 'initiateRequest');
    }
  }

  /**
   * Poll for consent until approved, then return endpoint & token.
   */
  public async pollForConsent(
    requestId: string,
    opts: Pick<RequestDataParams, 'pollingIntervalMs' | 'timeoutMs' | 'abortSignal'> = {}
  ): Promise<{ providerEndpoint: string; accessToken: string }> {
    const interval = opts.pollingIntervalMs ?? 3000;
    const timeout = opts.timeoutMs ?? 120000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (opts.abortSignal?.aborted) {
        throw new RequestError('ABORTED', 'Polling aborted by signal');
      }
      try {
        const { data } = await this.http.get(`/requests/${requestId}/token`);
        this.emit('statusChanged', { requestId, status: data.status });
        if (data.status === 'APPROVED') {
          return { providerEndpoint: data.providerEndpoint, accessToken: data.accessToken };
        }
        if (['DENIED', 'FAILED', 'EXPIRED'].includes(data.status)) {
          throw new RequestError(data.status, data.failureReason || data.status);
        }
      } catch (err) {
        if (err instanceof RequestError) throw err;
        this.handleApiError(err, 'pollForConsent');
      }
      await delay(interval);
    }
    throw new RequestError('TIMED_OUT', 'User consent polling timed out');
  }

  /**
   * Fetch actual data from provider endpoint.
   */
  public async fetchFromProvider<T>(endpoint: string, token: string): Promise<T> {
    try {
      const { data } = await axios.post<T>(endpoint, {}, { headers: { Authorization: `Bearer ${token}` } });
      this.emit('completed', { endpoint });
      return data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      throw new RequestError('FETCH_FAILED', `Fetch error ${status || ''}`);
    }
  }

  private handleApiError(err: unknown, context: string): never {
    if (axios.isAxiosError(err) && err.response) {
      const msg = err.response.data?.error || err.message;
      throw new RequestError('API_ERROR', `${context}: ${msg}`);
    }
    throw new RequestError('UNKNOWN', `${context}: ${(err as Error).message}`);
  }
}

