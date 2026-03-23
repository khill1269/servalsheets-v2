#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const serverJsonPath = path.join(repoRoot, 'server.json');
const packageJsonPath = path.join(repoRoot, 'package.json');
const localSchemaPath = path.resolve(repoRoot, 'docs', 'reference', 'server.schema.json');
const fallbackSchemaPath = path.resolve(
  repoRoot,
  '..',
  '..',
  'mcp-reference',
  'registry',
  'docs',
  'reference',
  'server-json',
  'server.schema.json'
);
const schemaPath =
  process.env.MCP_SERVER_SCHEMA_PATH ||
  (fs.existsSync(localSchemaPath) ? localSchemaPath : fallbackSchemaPath);

const TOOL_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const errors = [];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const assert = (condition, message) => {
  if (!condition) {
    errors.push(message);
  }
};

let serverJson;
let packageJson;
let serverSchema;

try {
  serverJson = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
} catch (error) {
  console.error(`Failed to read ${serverJsonPath}: ${error.message}`);
  process.exit(1);
}

try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (error) {
  console.error(`Failed to read ${packageJsonPath}: ${error.message}`);
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) {
  console.log(
    `Note: server.json schema not found at ${schemaPath}. Skipping JSON schema validation.`
  );
} else {
  try {
    serverSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    console.error(`Failed to read ${schemaPath}: ${error.message}`);
    process.exit(1);
  }
}

// The upstream registry schema caps icon URIs at 255 characters, which rejects
// inline SVG data URIs even though this repo intentionally embeds them.
if (serverSchema?.definitions?.Icon?.properties?.src?.maxLength === 255) {
  serverSchema.definitions.Icon.properties.src.maxLength = 8192;
}

assert(isNonEmptyString(serverJson.name), 'server.json: "name" must be a non-empty string');
assert(isNonEmptyString(serverJson.version), 'server.json: "version" must be a non-empty string');
assert(Array.isArray(serverJson.packages), 'server.json: "packages" must be an array');
assert(Array.isArray(serverJson.tools), 'server.json: "tools" must be an array');

if (isNonEmptyString(packageJson.mcpName)) {
  assert(
    serverJson.name === packageJson.mcpName,
    `server.json: "name" must match package.json "mcpName" (${packageJson.mcpName})`
  );
}

if (isNonEmptyString(packageJson.version)) {
  assert(
    serverJson.version === packageJson.version,
    `server.json: "version" must match package.json "version" (${packageJson.version})`
  );
}

if (Array.isArray(serverJson.tools)) {
  const seen = new Set();
  for (const tool of serverJson.tools) {
    assert(isNonEmptyString(tool.name), 'server.json: tool.name must be a non-empty string');
    if (isNonEmptyString(tool.name)) {
      assert(
        TOOL_NAME_PATTERN.test(tool.name),
        `server.json: tool.name "${tool.name}" must match ${TOOL_NAME_PATTERN}`
      );
      assert(!seen.has(tool.name), `server.json: duplicate tool.name "${tool.name}"`);
      seen.add(tool.name);
    }
    assert(
      isNonEmptyString(tool.description),
      'server.json: tool.description must be a non-empty string'
    );
  }
}

if (serverSchema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(serverSchema);
  const valid = validate(serverJson);
  if (!valid) {
    for (const err of validate.errors ?? []) {
      const location = err.instancePath && err.instancePath.length > 0 ? err.instancePath : '/';
      const message = err.message ?? 'schema validation error';
      errors.push(`server.json schema: ${location} ${message}`);
    }
  }
}

if (errors.length > 0) {
  console.error('server.json validation failed:');
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log('server.json validation passed.');
