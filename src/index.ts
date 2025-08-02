import axios, { AxiosInstance } from 'axios'; // REMOVED: Unused AxiosError import

// --- Type Definitions for a Professional SDK ---

/**
 * Configuration options required to initialize the TrustBrokerClient.
 */
export interface TrustBrokerClientConfig {
  /** Your unique client ID provided by the TrustBroker platform. */
  clientId: string;
  /** Your secret key. Keep this secure and NEVER expose it in a browser. */
  clientSecret: string;
  /** The base URL of the TrustBroker API. Defaults to the production URL. */
  apiBaseUrl?: string;
}

/**
 * Parameters for initiating a new data request.
 */
export interface RequestDataParams {
  /** The unique identifier for the data owner (e.g., Fayda ID). */
  ownerExternalId: string;
  /** The unique ID of the institution providing the data. */
  providerId: string;
  /** The identifier for the data schema being requested (e.g., 'salary_v1'). */
  schemaId: string;
  /** An optional array of specific fields you need from the schema. */
  neededData?: string[];
  /** The interval in milliseconds to poll for consent status. Defaults to 3000ms. */
  pollingIntervalMs?: number;
  /** The maximum time in milliseconds to wait for user consent before timing out. Defaults to 120,000ms (2 minutes). */
  timeoutMs?: number;
}

/**
 * Custom error class for handling specific platform errors, allowing users to
 * programmatically respond to different failure states.
 */
export class TrustBrokerError extends Error {
  /** The status code from the TrustBroker platform (e.g., 'DENIED', 'TIMED_OUT'). */
  public readonly status?: string;

  constructor(message: string, status?: string) {
    super(message);
    this.name = 'TrustBrokerError';
    this.status = status;
  }
}

// --- The Main Client Class ---

/**
 * The primary client for interacting with the TrustBroker Data Exchange Platform.
 */
export class TrustBrokerClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly clientId: string;
  private readonly clientSecret: string;

  /**
   * Creates an instance of the TrustBrokerClient.
   * @param {TrustBrokerClientConfig} config - The configuration object.
   */
  constructor(config: TrustBrokerClientConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('TrustBrokerClient Error: clientId and clientSecret are required.');
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    this.axiosInstance = axios.create({
      baseURL: config.apiBaseUrl || 'https://api.yourplatform.com/api/v1',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': this.clientId,
        'x-client-secret': this.clientSecret,
      },
    });
  }

  /**
   * Initiates a data request, waits for user consent, and fetches the consented data.
   * This method handles the entire multi-step flow automatically.
   *
   * @template T - The expected type of the data to be returned.
   * @param {RequestDataParams} params - The parameters for the data request.
   * @returns {Promise<T>} A promise that resolves with the data from the provider.
   * @throws {TrustBrokerError} If the request is denied, expires, or fails.
   * @throws {Error} For network issues or other unexpected errors.
   */
  public async requestData<T = any>(params: RequestDataParams): Promise<T> {
    const { ownerExternalId, providerId, schemaId, neededData } = params;

    // Step 1: Initiate the request to get a unique requestId
    const { requestId } = await this.#initiateRequest({ ownerExternalId, providerId, schemaId, neededData });
    
    // Step 2: Poll for the user's consent and retrieve the access token and provider endpoint
    const { providerEndpoint, accessToken } = await this.#pollForConsent(requestId, params);
    
    // Step 3: Use the access token to fetch the final data directly from the provider
    const finalData = await this.#fetchFromProvider<T>(providerEndpoint, accessToken);

    return finalData;
  }

  // --- Private Helper Methods ---

  // FIXED: Removed the redundant `private` keyword. The `#` makes it private.
  async #initiateRequest(body: Omit<RequestDataParams, 'pollingIntervalMs' | 'timeoutMs'>): Promise<{ requestId: string }> {
    try {
      const response = await this.axiosInstance.post('/requests', body);
      return response.data;
    } catch (error) {
      this.#handleApiError(error, 'Failed to initiate request');
    }
  }

  // FIXED: Removed the redundant `private` keyword.
  async #pollForConsent(
    requestId: string,
    params: RequestDataParams
  ): Promise<{ providerEndpoint: string; accessToken: string }> {
    const { pollingIntervalMs = 3000, timeoutMs = 120000 } = params;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await this.axiosInstance.get(`/requests/${requestId}/token`);
        const { status, providerEndpoint, accessToken, failureReason } = response.data;

        switch (status) {
          case 'APPROVED':
            if (!providerEndpoint || !accessToken) {
              throw new TrustBrokerError('Server approved request but did not provide token or endpoint.', 'INVALID_RESPONSE');
            }
            return { providerEndpoint, accessToken };
          case 'AWAITING_CONSENT':
          case 'INITIATED':
            // FIXED: setTimeout will now be recognized by TypeScript.
            await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
            continue; // Continue the loop
          case 'DENIED':
          case 'EXPIRED':
          case 'FAILED':
            throw new TrustBrokerError(failureReason || `Request failed with status: ${status}`, status);
          default:
            throw new TrustBrokerError(`Received unknown request status: ${status}`, status);
        }
      } catch (error) {
        if (error instanceof TrustBrokerError) throw error;
        this.#handleApiError(error, 'Failed while polling for consent');
      }
    }

    throw new TrustBrokerError('Request timed out while waiting for user consent.', 'TIMED_OUT');
  }

  // FIXED: Removed the redundant `private` keyword.
  async #fetchFromProvider<T>(providerEndpoint: string, accessToken: string): Promise<T> {
    try {
      const response = await axios.post<T>(
        providerEndpoint,
        {}, // Body is empty; authorization is in the token
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch data from provider at ${providerEndpoint}. Status: ${error.response?.status}`);
      }
      throw new Error(`An unexpected error occurred while fetching data from the provider.`);
    }
  }

  // FIXED: Removed the redundant `private` keyword.
  #handleApiError(error: any, contextMessage: string): never {
    if (axios.isAxiosError(error) && error.response) {
      const apiErrorMessage = error.response.data?.error || 'An unknown API error occurred';
      throw new Error(`${contextMessage}: ${apiErrorMessage} (Status Code: ${error.response.status})`);
    }
    throw new Error(`${contextMessage}: ${error.message}`);
  }
}
