import type { Validation } from "./contracts.ts";

export interface ValidationReader {
  getValidation(validationId: string): Promise<Validation>;
}

type HttpValidationReaderOptions = { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch };

/** Reads a validation from the Part 3 HTTP API. */
export class HttpValidationReader implements ValidationReader {
  baseUrl: string;
  apiKey: string;
  fetchImpl: typeof fetch;

  constructor(options: HttpValidationReaderOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getValidation(_validationId: string): Promise<Validation> {
    throw new Error("not implemented");
  }
}

export class FakeValidationReader implements ValidationReader {
  private validations: Map<string, Validation>;

  constructor(validations: Validation[]) {
    this.validations = new Map(validations.map((validation) => [validation.validationId, structuredClone(validation)]));
  }

  async getValidation(validationId: string): Promise<Validation> {
    const validation = this.validations.get(validationId);
    if (!validation) throw new Error(`Validation ${validationId} does not exist`);
    return structuredClone(validation);
  }
}

/** Builds the Part 3 reader from environment configuration when available. */
export function validationReaderFromEnv(): ValidationReader | undefined {
  throw new Error("not implemented");
}
