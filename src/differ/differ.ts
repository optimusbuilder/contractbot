import {
  OpenApiSpec,
  ApiChange,
  DiffResult,
  PathItem,
  SchemaObject,
  OperationObject,
} from "./types.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function diffSpecs(
  apiName: string,
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
): DiffResult {
  const changes: ApiChange[] = [];

  const oldPaths = oldSpec.paths ?? {};
  const newPaths = newSpec.paths ?? {};

  for (const [path, oldPathItem] of Object.entries(oldPaths)) {
    if (!newPaths[path]) {
      for (const method of getMethodsFromPath(oldPathItem)) {
        changes.push({
          severity: "breaking",
          path,
          method,
          description: `Endpoint removed: ${method.toUpperCase()} ${path}`,
        });
      }
      continue;
    }

    const newPathItem = newPaths[path];
    diffPathItem(path, oldPathItem, newPathItem, changes, oldSpec, newSpec);
  }

  for (const [path, newPathItem] of Object.entries(newPaths)) {
    if (!oldPaths[path]) {
      for (const method of getMethodsFromPath(newPathItem)) {
        changes.push({
          severity: "non-breaking",
          path,
          method,
          description: `New endpoint added: ${method.toUpperCase()} ${path}`,
        });
      }
    }
  }

  return {
    apiName,
    oldVersion: oldSpec.info?.version,
    newVersion: newSpec.info?.version,
    changes,
    breakingCount: changes.filter((c) => c.severity === "breaking").length,
    nonBreakingCount: changes.filter((c) => c.severity === "non-breaking")
      .length,
  };
}

function getMethodsFromPath(pathItem: PathItem): string[] {
  return HTTP_METHODS.filter(
    (m) => pathItem[m] !== undefined && pathItem[m] !== null,
  );
}

function diffPathItem(
  path: string,
  oldItem: PathItem,
  newItem: PathItem,
  changes: ApiChange[],
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
): void {
  for (const method of HTTP_METHODS) {
    const oldOp = oldItem[method] as OperationObject | undefined;
    const newOp = newItem[method] as OperationObject | undefined;

    if (oldOp && !newOp) {
      changes.push({
        severity: "breaking",
        path,
        method,
        description: `Method removed: ${method.toUpperCase()} ${path}`,
      });
      continue;
    }

    if (!oldOp && newOp) {
      changes.push({
        severity: "non-breaking",
        path,
        method,
        description: `Method added: ${method.toUpperCase()} ${path}`,
      });
      continue;
    }

    if (oldOp && newOp) {
      diffOperation(path, method, oldOp, newOp, changes, oldSpec, newSpec);
    }
  }
}

function diffOperation(
  path: string,
  method: string,
  oldOp: OperationObject,
  newOp: OperationObject,
  changes: ApiChange[],
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
): void {
  diffParameters(path, method, oldOp, newOp, changes);
  diffRequestBody(path, method, oldOp, newOp, changes, oldSpec, newSpec);
  diffResponses(path, method, oldOp, newOp, changes, oldSpec, newSpec);
}

function diffParameters(
  path: string,
  method: string,
  oldOp: OperationObject,
  newOp: OperationObject,
  changes: ApiChange[],
): void {
  const oldParams = oldOp.parameters ?? [];
  const newParams = newOp.parameters ?? [];

  const oldByName = new Map(oldParams.map((p) => [`${p.in}:${p.name}`, p]));
  const newByName = new Map(newParams.map((p) => [`${p.in}:${p.name}`, p]));

  for (const [key, oldParam] of oldByName) {
    if (!newByName.has(key)) {
      changes.push({
        severity: oldParam.required ? "breaking" : "non-breaking",
        path,
        method,
        field: oldParam.name,
        description: `Parameter removed: ${oldParam.name} (${oldParam.in})`,
        oldValue: oldParam,
      });
    }
  }

  for (const [key, newParam] of newByName) {
    if (!oldByName.has(key)) {
      changes.push({
        severity: newParam.required ? "breaking" : "non-breaking",
        path,
        method,
        field: newParam.name,
        description: `Parameter added: ${newParam.name} (${newParam.in})${newParam.required ? " [required]" : ""}`,
        newValue: newParam,
      });
    }
  }
}

function diffRequestBody(
  path: string,
  method: string,
  oldOp: OperationObject,
  newOp: OperationObject,
  changes: ApiChange[],
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
): void {
  const oldBody = oldOp.requestBody;
  const newBody = newOp.requestBody;

  if (!oldBody && newBody?.required) {
    changes.push({
      severity: "breaking",
      path,
      method,
      description: "Required request body added",
    });
    return;
  }

  if (oldBody && !newBody) {
    changes.push({
      severity: "non-breaking",
      path,
      method,
      description: "Request body removed",
    });
    return;
  }

  if (oldBody?.content && newBody?.content) {
    const oldSchema = extractSchema(oldBody.content, oldSpec);
    const newSchema = extractSchema(newBody.content, newSpec);

    if (oldSchema && newSchema) {
      diffSchemaProperties(
        path,
        method,
        "request body",
        oldSchema,
        newSchema,
        changes,
        oldSpec,
        newSpec,
      );
    }
  }
}

function diffResponses(
  path: string,
  method: string,
  oldOp: OperationObject,
  newOp: OperationObject,
  changes: ApiChange[],
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
): void {
  const oldResponses = oldOp.responses ?? {};
  const newResponses = newOp.responses ?? {};

  for (const [status, oldResp] of Object.entries(oldResponses)) {
    const newResp = newResponses[status];
    if (!newResp) {
      changes.push({
        severity: "info",
        path,
        method,
        description: `Response ${status} removed`,
      });
      continue;
    }

    if (oldResp.content && newResp.content) {
      const oldSchema = extractSchema(oldResp.content, oldSpec);
      const newSchema = extractSchema(newResp.content, newSpec);

      if (oldSchema && newSchema) {
        diffSchemaProperties(
          path,
          method,
          `response ${status}`,
          oldSchema,
          newSchema,
          changes,
          oldSpec,
          newSpec,
        );
      }
    }
  }
}

function diffSchemaProperties(
  path: string,
  method: string,
  location: string,
  oldSchema: SchemaObject,
  newSchema: SchemaObject,
  changes: ApiChange[],
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
): void {
  const oldResolved = resolveRef(oldSchema, oldSpec);
  const newResolved = resolveRef(newSchema, newSpec);

  const oldProps = oldResolved.properties ?? {};
  const newProps = newResolved.properties ?? {};
  const oldRequired = new Set(oldResolved.required ?? []);
  const newRequired = new Set(newResolved.required ?? []);

  for (const propName of Object.keys(oldProps)) {
    if (!newProps[propName]) {
      changes.push({
        severity: "breaking",
        path,
        method,
        field: propName,
        description: `Field removed from ${location}: ${propName}`,
        oldValue: oldProps[propName],
      });
    }
  }

  for (const propName of Object.keys(newProps)) {
    if (!oldProps[propName]) {
      const isNowRequired = newRequired.has(propName);
      changes.push({
        severity: isNowRequired ? "breaking" : "non-breaking",
        path,
        method,
        field: propName,
        description: `Field added to ${location}: ${propName}${isNowRequired ? " [required]" : ""}`,
        newValue: newProps[propName],
      });
    }
  }

  for (const propName of Object.keys(oldProps)) {
    if (!newProps[propName]) continue;

    if (!oldRequired.has(propName) && newRequired.has(propName)) {
      changes.push({
        severity: "breaking",
        path,
        method,
        field: propName,
        description: `Field became required in ${location}: ${propName}`,
      });
    }

    const oldType = resolveRef(oldProps[propName], oldSpec).type;
    const newType = resolveRef(newProps[propName], newSpec).type;
    if (oldType && newType && oldType !== newType) {
      changes.push({
        severity: "breaking",
        path,
        method,
        field: propName,
        description: `Field type changed in ${location}: ${propName} (${oldType} → ${newType})`,
        oldValue: oldType,
        newValue: newType,
      });
    }
  }
}

function extractSchema(
  content: Record<string, { schema?: SchemaObject }>,
  spec: OpenApiSpec,
): SchemaObject | null {
  const json = content["application/json"];
  if (!json?.schema) return null;
  return resolveRef(json.schema, spec);
}

function resolveRef(schema: SchemaObject, spec: OpenApiSpec): SchemaObject {
  if (!schema.$ref) return schema;

  const refPath = schema.$ref.replace("#/", "").split("/");
  let current: unknown = spec;

  for (const segment of refPath) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return schema;
    }
  }

  return (current as SchemaObject) ?? schema;
}
