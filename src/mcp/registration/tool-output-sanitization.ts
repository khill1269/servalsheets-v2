import { isPlainRecord, type PlainRecord } from './tool-response-normalization.js';

export interface OutputSanitizationFinding {
  path: string;
  ruleId: string;
  replacements: number;
}

type SanitizationRule = {
  id: string;
  pattern: RegExp;
  replacement: string;
};

const OUTPUT_SANITIZATION_RULES: SanitizationRule[] = [
  {
    id: 'instruction_override',
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+instructions/gi,
    replacement: '[REDACTED_INSTRUCTION_OVERRIDE]',
  },
  {
    id: 'system_prompt_exfiltration',
    pattern:
      /(?:reveal|show|print|dump|expose)\s+(?:the\s+)?(?:system\s+prompt|developer\s+message|hidden\s+prompt)/gi,
    replacement: '[REDACTED_PROMPT_EXFILTRATION]',
  },
  {
    id: 'credential_exfiltration',
    pattern:
      /(?:send|return|exfiltrat(?:e|ion)|leak|provide)\s+(?:your\s+)?(?:api\s*key|token|secret|credentials?)/gi,
    replacement: '[REDACTED_CREDENTIAL_EXFILTRATION]',
  },
  {
    id: 'safety_bypass',
    pattern: /(?:bypass|disable|override)\s+(?:the\s+)?(?:safety|guardrails?|security|policy)/gi,
    replacement: '[REDACTED_SAFETY_BYPASS]',
  },
  {
    id: 'hidden_channel',
    pattern: /(?:do\s+not\s+tell\s+the\s+user|assistant\s+only|for\s+the\s+model\s+only)/gi,
    replacement: '[REDACTED_HIDDEN_CHANNEL]',
  },
];

function sanitizeString(
  value: string,
  path: string,
  findings: OutputSanitizationFinding[]
): string {
  let sanitized = value;

  for (const rule of OUTPUT_SANITIZATION_RULES) {
    const matches = Array.from(sanitized.matchAll(rule.pattern));
    if (matches.length === 0) {
      continue;
    }

    sanitized = sanitized.replace(rule.pattern, rule.replacement);
    findings.push({
      path,
      ruleId: rule.id,
      replacements: matches.length,
    });
  }

  return sanitized;
}

function sanitizeValue(
  value: unknown,
  path: string,
  findings: OutputSanitizationFinding[]
): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, path, findings);
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      value[index] = sanitizeValue(item, `${path}[${index}]`, findings);
    }
    return value;
  }

  if (isPlainRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === 'error' || key === '_meta') {
        continue;
      }
      value[key] = sanitizeValue(nestedValue, `${path}.${key}`, findings);
    }
    return value;
  }

  return value;
}

export function sanitizeToolOutput(response: PlainRecord): OutputSanitizationFinding[] {
  const findings: OutputSanitizationFinding[] = [];

  sanitizeValue(response, 'response', findings);

  return findings;
}
