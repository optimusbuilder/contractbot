export interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, SchemaObject> };
  definitions?: Record<string, SchemaObject>; // Swagger 2.0
}

export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  [key: string]: unknown;
}

export interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  [key: string]: unknown;
}

export interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  schema?: SchemaObject;
  [key: string]: unknown;
}

export interface RequestBodyObject {
  required?: boolean;
  content?: Record<string, { schema?: SchemaObject }>;
  [key: string]: unknown;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
  [key: string]: unknown;
}

export interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  $ref?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

export type ChangeSeverity = "breaking" | "non-breaking" | "info";

export interface ApiChange {
  severity: ChangeSeverity;
  path: string;
  method: string;
  description: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffResult {
  apiName: string;
  oldVersion?: string;
  newVersion?: string;
  changes: ApiChange[];
  breakingCount: number;
  nonBreakingCount: number;
}
