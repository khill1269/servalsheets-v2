import type { drive_v3 } from 'googleapis';
import type {
  CollaborateLabelApplyInput,
  CollaborateLabelListInput,
  CollaborateLabelRemoveInput,
  CollaborateListAccessProposalsInput,
  CollaborateResolveAccessProposalInput,
  CollaborateResponse,
} from '../../schemas/index.js';
import type { MutationSummary } from '../../schemas/shared.js';

interface AccessLabelsDeps {
  driveApi: drive_v3.Drive;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => CollaborateResponse;
}

/**
 * Decomposed action handler for `list_access_proposals`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleListAccessProposalsAction(
  input: CollaborateListAccessProposalsInput,
  deps: AccessLabelsDeps
): Promise<CollaborateResponse> {
  const driveClient = deps.driveApi as unknown as {
    accessproposals: {
      list: (params: {
        fileId: string;
        pageSize?: number;
        pageToken?: string;
      }) => Promise<{ data: { accessProposals?: unknown[]; nextPageToken?: string } }>;
    };
  };

  const listParams: { fileId: string; pageSize?: number; pageToken?: string } = {
    fileId: input.spreadsheetId!,
    pageSize: input.pageSize ?? 20,
  };
  if (input.pageToken) listParams.pageToken = input.pageToken;

  const response = await driveClient.accessproposals.list(listParams);

  const proposals = response.data.accessProposals ?? [];
  const nextPageToken = response.data.nextPageToken;

  return deps.success('list_access_proposals', {
    proposals,
    ...(nextPageToken ? { nextPageToken } : {}),
  });
}

/**
 * Decomposed action handler for `resolve_access_proposal`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleResolveAccessProposalAction(
  input: CollaborateResolveAccessProposalInput,
  deps: AccessLabelsDeps
): Promise<CollaborateResponse> {
  const driveClient = deps.driveApi as unknown as {
    accessproposals: {
      resolve: (params: {
        fileId: string;
        proposalId: string;
        requestBody: { action: string; role?: string; sendNotification?: boolean };
      }) => Promise<unknown>;
    };
  };

  const requestBody: { action: string; role?: string; sendNotification?: boolean } = {
    action: input.decision,
    sendNotification: input.sendNotification ?? true,
  };
  if (input.decision === 'APPROVE' && input.role) {
    requestBody.role = input.role;
  }

  await driveClient.accessproposals.resolve({
    fileId: input.spreadsheetId!,
    proposalId: input.proposalId!,
    requestBody,
  });

  return deps.success('resolve_access_proposal', {
    proposalId: input.proposalId,
    decision: input.decision,
  });
}

/**
 * Decomposed action handler for `label_list`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleLabelListAction(
  input: CollaborateLabelListInput,
  deps: AccessLabelsDeps
): Promise<CollaborateResponse> {
  const fileId = (input.fileId ?? input.spreadsheetId)!;

  const driveClient = deps.driveApi as unknown as {
    files: {
      get: (params: {
        fileId: string;
        fields: string;
        includeLabels?: string;
      }) => Promise<{ data: { labelInfo?: { labels?: unknown[] } } }>;
    };
  };

  const params: { fileId: string; fields: string; includeLabels?: string } = {
    fileId,
    fields: 'labelInfo',
  };
  if (input.includeLabels && input.includeLabels.length > 0) {
    params.includeLabels = input.includeLabels.join(',');
  }

  const response = await driveClient.files.get(params);
  const labels = (response.data.labelInfo?.labels ?? []) as Record<string, unknown>[];

  return deps.success('label_list', {
    fileId,
    labels,
  });
}

/**
 * Decomposed action handler for `label_apply`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleLabelApplyAction(
  input: CollaborateLabelApplyInput,
  deps: AccessLabelsDeps
): Promise<CollaborateResponse> {
  const fileId = (input.fileId ?? input.spreadsheetId)!;

  const driveClient = deps.driveApi as unknown as {
    files: {
      modifyLabels: (params: {
        fileId: string;
        requestBody: {
          labelModifications: Array<{
            labelId: string;
            fieldModifications?: Array<{ fieldId: string; setDateValues?: unknown }>;
          }>;
        };
      }) => Promise<{ data: { modifiedLabels?: unknown[] } }>;
    };
  };

  const labelModification: {
    labelId: string;
    fieldModifications: Array<{ fieldId: string; setTextValues?: { values: string[] } }>;
  } = {
    labelId: input.labelId,
    fieldModifications: [],
  };

  if (input.labelFields) {
    for (const [fieldId, value] of Object.entries(input.labelFields)) {
      labelModification.fieldModifications.push({
        fieldId,
        setTextValues: { values: [String(value)] },
      });
    }
  }

  await driveClient.files.modifyLabels({
    fileId,
    requestBody: {
      labelModifications: [labelModification],
    },
  });

  return deps.success(
    'label_apply',
    {
      fileId,
      labelId: input.labelId,
    },
    undefined,
    true
  );
}

/**
 * Decomposed action handler for `label_remove`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleLabelRemoveAction(
  input: CollaborateLabelRemoveInput,
  deps: AccessLabelsDeps
): Promise<CollaborateResponse> {
  const fileId = (input.fileId ?? input.spreadsheetId)!;

  const driveClient = deps.driveApi as unknown as {
    files: {
      modifyLabels: (params: {
        fileId: string;
        requestBody: {
          labelModifications: Array<{
            labelId: string;
            removeLabel?: boolean;
          }>;
        };
      }) => Promise<{ data: unknown }>;
    };
  };

  await driveClient.files.modifyLabels({
    fileId,
    requestBody: {
      labelModifications: [
        {
          labelId: input.labelId,
          removeLabel: true,
        },
      ],
    },
  });

  return deps.success(
    'label_remove',
    {
      fileId,
      labelId: input.labelId,
    },
    undefined,
    true
  );
}
