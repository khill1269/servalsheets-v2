import { ErrorCodes } from '../error-codes.js';
import type { drive_v3 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CollaborateResponse,
  CollaborateShareAddInput,
  CollaborateShareGetInput,
  CollaborateShareGetLinkInput,
  CollaborateShareListInput,
  CollaborateShareRemoveInput,
  CollaborateShareSetLinkInput,
  CollaborateShareTransferOwnershipInput,
  CollaborateShareUpdateInput,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { elicitSharingSettings, confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { driveRateLimiter } from '../../utils/drive-rate-limiter.js';
import { TimeoutError, withTimeout } from '../../utils/timeout.js';

type CollaborateSuccess = Extract<CollaborateResponse, { success: true }>;

interface SharingDeps {
  driveApi: drive_v3.Drive;
  context: HandlerContext;
  mapPermission: (
    permission: drive_v3.Schema$Permission | undefined
  ) => NonNullable<CollaborateSuccess['permission']>;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => CollaborateResponse;
  error: (error: ErrorDetail) => CollaborateResponse;
}

const MAX_PERMISSION_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000;
const SHARE_PERMISSION_TIMEOUT_MS = 15_000;

function extractDriveErrorCode(error: unknown): number | string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined; // OK: Explicit empty — non-object has no error code
  }

  const candidate = error as {
    code?: number | string;
    status?: number | string;
    response?: { status?: number | string };
    errors?: Array<{ reason?: string }>;
  };

  return (
    candidate.code ??
    candidate.status ??
    candidate.response?.status ??
    candidate.errors?.[0]?.reason
  );
}

function extractDriveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      message?: string;
      response?: { data?: { error?: { message?: string } } };
      errors?: Array<{ message?: string }>;
    };

    return (
      candidate.message ??
      candidate.response?.data?.error?.message ??
      candidate.errors?.[0]?.message ??
      String(error)
    );
  }

  return String(error);
}

function describeShareTarget(input: CollaborateShareAddInput): string {
  if (input.emailAddress) {
    return input.emailAddress;
  }
  if (input.domain) {
    return input.domain;
  }
  return input.type ?? 'recipient';
}

function classifyShareAddFailure(
  error: unknown,
  input: CollaborateShareAddInput
): ErrorDetail | undefined {
  const target = describeShareTarget(input);

  if (error instanceof TimeoutError) {
    return {
      code: ErrorCodes.DEADLINE_EXCEEDED,
      message:
        `Drive permission creation for "${target}" timed out after ${error.timeoutMs}ms. ` +
        'This often happens when Google is slow to validate the recipient account or group.',
      retryable: true,
      suggestedFix:
        'Verify the recipient is a real Google account or Google Group, then retry. If the target is valid, retry later.',
      details: {
        target,
        timeoutMs: error.timeoutMs,
      },
    };
  }

  const errorCode = extractDriveErrorCode(error);
  const message = extractDriveErrorMessage(error);
  const normalized = message.toLowerCase();

  if (
    (errorCode === 400 || errorCode === '400') &&
    (normalized.includes('invalid sharing request') ||
      normalized.includes('email address') ||
      normalized.includes('invalid email') ||
      normalized.includes('not a valid') ||
      normalized.includes('not found') ||
      normalized.includes('cannot share'))
  ) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message:
        `Google Drive rejected the share target "${target}". ` +
        'Verify it is a valid Google account, Google Group, or allowed domain before retrying.',
      retryable: false,
      suggestedFix:
        'Use a valid Google account or Google Group email address, or switch the share type to a valid domain/anyone mode.',
      details: {
        target,
        originalMessage: message,
        errorCode,
      },
    };
  }

  return undefined; // OK: Explicit empty — unrecognized Drive error shape
}

function validatePermissionExpiration(
  expirationTime: string,
  permissionType: string | undefined
): ErrorDetail | undefined {
  if (permissionType !== 'user' && permissionType !== 'group') {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'expirationTime is only supported for user and group permissions.',
      retryable: false,
    };
  }

  const expirationMs = Date.parse(expirationTime);
  if (Number.isNaN(expirationMs)) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'expirationTime must be a valid RFC 3339 timestamp.',
      retryable: false,
    };
  }

  const now = Date.now();
  if (expirationMs <= now) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'expirationTime must be in the future.',
      retryable: false,
    };
  }

  if (expirationMs - now > MAX_PERMISSION_EXPIRATION_MS) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'expirationTime cannot be more than one year in the future.',
      retryable: false,
    };
  }

  return undefined; // OK: no expiry validation needed
}

/** Basic domain format check: e.g. "example.com" or "sub.domain.co.uk" */
function isValidDomain(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
}

/**
 * Pre-flight validation for share_add to fail fast before API call.
 * Prevents unnecessary Drive API requests (and the associated 15s timeout)
 * when required fields are missing or obviously malformed.
 */
function validateShareAddInput(input: CollaborateShareAddInput): ErrorDetail | undefined {
  if (!input.type) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message:
        'type is required for share_add (valid values: user, group, domain, anyone). ' +
        'Use "user" to share with a specific email, "domain" to share with a whole domain, or "anyone" for public access.',
      retryable: false,
      suggestedFix: 'Add type to the request, e.g. "type": "user".',
    };
  }
  const permType = input.type;

  if (permType === 'user' || permType === 'group') {
    if (!input.emailAddress) {
      return {
        code: ErrorCodes.VALIDATION_ERROR,
        message: `emailAddress is required when type="${permType}". Provide a valid Google account or Google Group email.`,
        retryable: false,
        suggestedFix: 'Add emailAddress to the request, e.g. "emailAddress": "user@example.com".',
      };
    }
    // Zod has already validated format via .email(), but if somehow it bypassed:
    if (!input.emailAddress.includes('@')) {
      return {
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Invalid email address format: "${input.emailAddress}". Must be a valid email.`,
        retryable: false,
      };
    }
  }

  if (permType === 'domain') {
    if (!input.domain) {
      return {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'domain is required when type="domain". Provide a domain like "example.com".',
        retryable: false,
        suggestedFix: 'Add domain to the request, e.g. "domain": "example.com".',
      };
    }
    if (!isValidDomain(input.domain)) {
      return {
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Invalid domain format: "${input.domain}". Provide a domain like "example.com" (not a URL or email).`,
        retryable: false,
        suggestedFix: 'Use just the domain name, e.g. "example.com", not "https://example.com".',
      };
    }
  }

  return undefined; // OK: no validation error — input is acceptable
}

/**
 * Decomposed action handler for `share_add`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareAddAction(
  input: CollaborateShareAddInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  let resolvedInput = input;
  if (!input.emailAddress && (input.type === 'user' || !input.type) && deps.context.server) {
    try {
      const spreadsheetTitle = input.spreadsheetId ?? 'this spreadsheet';
      const wizardResult = await elicitSharingSettings(deps.context.server, spreadsheetTitle);
      if (wizardResult) {
        resolvedInput = {
          ...input,
          type: input.type ?? 'user',
          emailAddress: wizardResult.email,
          role: wizardResult.role,
          sendNotification: wizardResult.sendNotification,
          emailMessage: wizardResult.message,
        } as CollaborateShareAddInput;
      }
    } catch {
      // non-blocking - proceed with provided input
    }
  }

  // Pre-flight validation: fail fast before any API call
  const preflightError = validateShareAddInput(resolvedInput);
  if (preflightError) {
    return deps.error(preflightError);
  }

  // Idempotency guard: check if permission already exists
  try {
    const existingPermissions = await deps.driveApi.permissions.list({
      fileId: resolvedInput.spreadsheetId!,
      fields: 'permissions(id,type,role,emailAddress,domain)',
      supportsAllDrives: true,
    });

    const permissions = existingPermissions.data.permissions ?? [];
    let matchingPermission: drive_v3.Schema$Permission | undefined;

    if (resolvedInput.type === 'user' || resolvedInput.type === 'group') {
      matchingPermission = permissions.find(
        (p) =>
          p.type === resolvedInput.type &&
          p.emailAddress?.toLowerCase() === resolvedInput.emailAddress?.toLowerCase()
      );
      if (matchingPermission) {
        // Check if existing role is same or higher
        const roleHierarchy: Record<string, number> = {
          owner: 3,
          organizer: 2,
          fileOrganizer: 2,
          writer: 1,
          commenter: 1,
          reader: 0,
        };
        const existingRoleLevel = roleHierarchy[matchingPermission.role ?? 'reader'] ?? 0;
        const requestedRoleLevel = roleHierarchy[resolvedInput.role ?? 'reader'] ?? 0;
        if (existingRoleLevel >= requestedRoleLevel) {
          return deps.success('share_add', {
            permission: deps.mapPermission(matchingPermission),
            _idempotent: true,
            _hint: `Permission already exists for ${resolvedInput.emailAddress} with role "${matchingPermission.role}". Returning existing permission.`,
          });
        }
      }
    } else if (resolvedInput.type === 'domain') {
      matchingPermission = permissions.find(
        (p) =>
          p.type === 'domain' &&
          p.domain?.toLowerCase() === resolvedInput.domain?.toLowerCase()
      );
      if (matchingPermission) {
        const roleHierarchy: Record<string, number> = {
          owner: 3,
          organizer: 2,
          fileOrganizer: 2,
          writer: 1,
          commenter: 1,
          reader: 0,
        };
        const existingRoleLevel = roleHierarchy[matchingPermission.role ?? 'reader'] ?? 0;
        const requestedRoleLevel = roleHierarchy[resolvedInput.role ?? 'reader'] ?? 0;
        if (existingRoleLevel >= requestedRoleLevel) {
          return deps.success('share_add', {
            permission: deps.mapPermission(matchingPermission),
            _idempotent: true,
            _hint: `Permission already exists for domain "${resolvedInput.domain}" with role "${matchingPermission.role}". Returning existing permission.`,
          });
        }
      }
    } else if (resolvedInput.type === 'anyone') {
      matchingPermission = permissions.find((p) => p.type === 'anyone');
      if (matchingPermission) {
        const roleHierarchy: Record<string, number> = {
          owner: 3,
          organizer: 2,
          fileOrganizer: 2,
          writer: 1,
          commenter: 1,
          reader: 0,
        };
        const existingRoleLevel = roleHierarchy[matchingPermission.role ?? 'reader'] ?? 0;
        const requestedRoleLevel = roleHierarchy[resolvedInput.role ?? 'reader'] ?? 0;
        if (existingRoleLevel >= requestedRoleLevel) {
          return deps.success('share_add', {
            permission: deps.mapPermission(matchingPermission),
            _idempotent: true,
            _hint: `Permission already exists for "anyone" with role "${matchingPermission.role}". Returning existing permission.`,
          });
        }
      }
    }
  } catch {
    // Non-blocking: proceed with creation if permission check fails
  }

  await driveRateLimiter.acquire();
  const requestBody: drive_v3.Schema$Permission = {
    type: resolvedInput.type,
    role: resolvedInput.role,
  };
  if (resolvedInput.emailAddress) requestBody.emailAddress = resolvedInput.emailAddress;
  if (resolvedInput.domain) requestBody.domain = resolvedInput.domain;
  if (resolvedInput.expirationTime) {
    const validationError = validatePermissionExpiration(
      resolvedInput.expirationTime,
      resolvedInput.type
    );
    if (validationError) {
      return deps.error(validationError);
    }
    requestBody.expirationTime = resolvedInput.expirationTime;
  }

  let response;
  try {
    response = await withTimeout(
      () =>
        deps.driveApi.permissions.create({
          fileId: resolvedInput.spreadsheetId!,
          sendNotificationEmail: resolvedInput.sendNotification ?? true,
          emailMessage: resolvedInput.emailMessage,
          requestBody,
          fields: 'id,type,role,emailAddress,domain,displayName,expirationTime',
          supportsAllDrives: true,
        }),
      SHARE_PERMISSION_TIMEOUT_MS,
      'sheets_collaborate.share_add'
    );
  } catch (error) {
    const classified = classifyShareAddFailure(error, resolvedInput);
    if (classified) {
      return deps.error(classified);
    }
    throw error;
  }

  return deps.success('share_add', {
    permission: deps.mapPermission(response.data),
  });
}

/**
 * Decomposed action handler for `share_update`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareUpdateAction(
  input: CollaborateShareUpdateInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  await driveRateLimiter.acquire();
  if (input.role === 'owner') {
    return deps.error({
      code: ErrorCodes.VALIDATION_ERROR,
      message:
        'Cannot change role to "owner" via share_update. Use share_transfer_ownership instead, ' +
        'which handles the required transferOwnership flag and pending acceptance flow.',
      retryable: false,
    });
  }

  if (input.safety?.dryRun) {
    return deps.success('share_update', {}, undefined, true);
  }

  if (input.expirationTime) {
    const permissionResponse = await deps.driveApi.permissions.get({
      fileId: input.spreadsheetId!,
      permissionId: input.permissionId!,
      supportsAllDrives: true,
      fields: 'type',
    });

    const validationError = validatePermissionExpiration(
      input.expirationTime,
      permissionResponse.data.type ?? undefined
    );
    if (validationError) {
      return deps.error(validationError);
    }
  }

  const response = await deps.driveApi.permissions.update({
    fileId: input.spreadsheetId!,
    permissionId: input.permissionId!,
    transferOwnership: false,
    requestBody: {
      role: input.role,
      expirationTime: input.expirationTime,
    },
    fields: 'id,type,role,emailAddress,domain,displayName,expirationTime',
    supportsAllDrives: true,
  });

  return deps.success('share_update', {
    permission: deps.mapPermission(response.data),
  });
}

/**
 * Decomposed action handler for `share_remove`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareRemoveAction(
  input: CollaborateShareRemoveInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  await driveRateLimiter.acquire();
  if (input.safety?.dryRun) {
    return deps.success('share_remove', {}, undefined, true);
  }

  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'share_remove',
      `Remove permission (ID: ${input.permissionId}) from spreadsheet ${input.spreadsheetId}. This will revoke access for the user. This action cannot be undone.`
    );

    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'share_remove',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await deps.driveApi.permissions.delete({
    fileId: input.spreadsheetId!,
    permissionId: input.permissionId!,
    supportsAllDrives: true,
  });

  return deps.success('share_remove', {
    snapshotId: snapshot?.snapshotId,
  });
}

/**
 * Decomposed action handler for `share_list`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareListAction(
  input: CollaborateShareListInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.permissions.list({
    fileId: input.spreadsheetId!,
    supportsAllDrives: true,
    pageSize: 100,
    pageToken: (input as typeof input & { pageToken?: string }).pageToken ?? undefined,
    fields:
      'nextPageToken,permissions(id,type,role,emailAddress,domain,displayName,expirationTime)',
  });

  const permissions = (response.data.permissions ?? []).map((permission) =>
    deps.mapPermission(permission)
  );

  return deps.success('share_list', {
    permissions,
    nextPageToken: response.data.nextPageToken ?? undefined,
  });
}

/**
 * Decomposed action handler for `share_get`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareGetAction(
  input: CollaborateShareGetInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.permissions.get({
    fileId: input.spreadsheetId!,
    permissionId: input.permissionId!,
    supportsAllDrives: true,
    fields: 'id,type,role,emailAddress,domain,displayName,expirationTime',
  });

  return deps.success('share_get', {
    permission: deps.mapPermission(response.data),
  });
}

/**
 * Decomposed action handler for `share_transfer_ownership`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareTransferOwnershipAction(
  input: CollaborateShareTransferOwnershipInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  await driveRateLimiter.acquire();
  if (input.safety?.dryRun) {
    return deps.success('share_transfer_ownership', {}, undefined, true);
  }

  const response = await deps.driveApi.permissions.create({
    fileId: input.spreadsheetId!,
    transferOwnership: true,
    moveToNewOwnersRoot: true,
    sendNotificationEmail: true,
    requestBody: {
      type: 'user',
      role: 'owner',
      emailAddress: input.newOwnerEmail!,
    },
    fields: 'id,type,role,emailAddress,displayName',
    supportsAllDrives: true,
  });

  return deps.success('share_transfer_ownership', {
    permission: deps.mapPermission(response.data),
    pendingAcceptance: (response.data as Record<string, unknown>)['pendingOwner'] === true,
  });
}

/**
 * Decomposed action handler for `share_set_link`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareSetLinkAction(
  input: CollaborateShareSetLinkInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  if (!input.enabled) {
    const allPermissions: drive_v3.Schema$Permission[] = [];
    let pageToken: string | undefined;

    do {
      const list = await deps.driveApi.permissions.list({
        fileId: input.spreadsheetId!,
        supportsAllDrives: true,
        pageSize: 100,
        pageToken,
        fields: 'nextPageToken,permissions(id,type)',
      });
      allPermissions.push(...(list.data.permissions ?? []));
      pageToken = list.data.nextPageToken ?? undefined;
    } while (pageToken);

    const anyone = allPermissions.find((p) => p.type === 'anyone');
    if (anyone?.id && !input.safety?.dryRun) {
      await deps.driveApi.permissions.delete({
        fileId: input.spreadsheetId!,
        permissionId: anyone.id,
        supportsAllDrives: true,
      });
    }
    return deps.success('share_set_link', {}, undefined, input.safety?.dryRun ?? false);
  }

  const response = await deps.driveApi.permissions.create({
    fileId: input.spreadsheetId!,
    supportsAllDrives: true,
    requestBody: {
      type: 'anyone',
      role: input.role ?? 'reader',
      allowFileDiscovery: input.allowFileDiscovery === true,
    },
    fields: 'id,type,role,emailAddress,displayName,allowFileDiscovery',
  });

  return deps.success('share_set_link', {
    permission: deps.mapPermission(response.data),
  });
}

/**
 * Decomposed action handler for `share_get_link`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleShareGetLinkAction(
  input: CollaborateShareGetLinkInput,
  deps: SharingDeps
): Promise<CollaborateResponse> {
  const baseUrl = `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`;
  const sharingLink = `${baseUrl}/edit?usp=sharing`;
  return deps.success('share_get_link', { sharingLink });
}
