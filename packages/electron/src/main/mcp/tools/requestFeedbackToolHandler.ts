/**
 * The cross-user `RequestFeedback` tool. Product feedback and GitHub issue
 * reporting remain in the adjacent `feedbackToolHandlers.ts` module.
 */

import {
  STRUCTURED_INPUT_FIELD_TYPES,
  validateFeedbackRequest,
  type FeedbackAsk,
  type FeedbackAskAssignment,
  type FeedbackRequestRecipient,
  type FeedbackRequestVisibility,
  type ResourceRef,
} from '@nimbalyst/collab-protocol';
import {
  loadOrgDirectory,
  readResourceSharingStatus,
  type OrgDirectoryResult,
  type ResourceSharingKind,
  type ResourceSharingResult,
} from './collabReadToolHandlers';

type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
};

type RecipientInput = {
  key: string;
  nameOrEmail: string;
};

type SubjectInput = {
  kind: ResourceSharingKind;
  sourceId: string;
  label?: string;
  context?: string;
  projectId?: string;
};

type AssignmentInput = {
  askId: string;
  recipientKey: string;
};

type RequestFeedbackInput = {
  recipients: RecipientInput[];
  asks: FeedbackAsk[];
  assignments?: AssignmentInput[];
  subjects: SubjectInput[];
  visibility: FeedbackRequestVisibility;
  quorum: { requiredRecipientCount: number };
  deadline?: number;
};

export type RequestFeedbackOutcome =
  | {
      status: 'draftReady';
      message: string;
      draft: {
        orgId: string;
        recipients: FeedbackRequestRecipient[];
        asks: FeedbackAsk[];
        assignments: FeedbackAskAssignment[];
        subjects: Array<{
          ref: ResourceRef;
          label: string;
          context?: string;
          shared: boolean;
        }>;
        visibility: FeedbackRequestVisibility;
        quorum: { requiredRecipientCount: number };
        quorumMode: 'first' | 'all';
        deadline?: number;
      };
    }
  | {
      status: 'ambiguousRecipient';
      action: 'askWhichRecipient';
      message: string;
      recipientKey: string;
      nameOrEmail: string;
      matches: OrgDirectoryResult['members'];
    }
  | {
      status: 'recipientNotFound';
      message: string;
      recipientKey: string;
      nameOrEmail: string;
    }
  | {
      status: 'noTeam';
      message: string;
    }
  | {
      status: 'subjectNotFound';
      message: string;
      subject: SubjectInput;
    }
  | {
      status: 'invalidDraft';
      message: string;
      errors: Array<{ code: string; message: string }>;
    };

type RequestFeedbackDependencies = {
  findOrgMembers(query: string, workspacePath: string): Promise<OrgDirectoryResult>;
  getResourceSharingStatus(
    kind: ResourceSharingKind,
    sourceId: string,
    workspacePath: string,
  ): Promise<ResourceSharingResult>;
};

const requestFeedbackDependencies: RequestFeedbackDependencies = {
  findOrgMembers: (query, workspacePath) => loadOrgDirectory(workspacePath, query),
  getResourceSharingStatus: (kind, sourceId, workspacePath) =>
    readResourceSharingStatus(kind, sourceId, workspacePath),
};

const STRUCTURED_ASK_SCHEMA = {
  type: 'object',
  description:
    'One typed ask. Required by type: singleSelect uses options; multiSelect and reorder use items; editText uses initialText; confirm has no additional required field; rating uses min and max.',
  properties: {
    type: {
      type: 'string',
      enum: [...STRUCTURED_INPUT_FIELD_TYPES, 'rating'],
    },
    id: { type: 'string', description: 'Stable ask id used by assignments.' },
    label: { type: 'string', description: 'Short label shown above the ask.' },
    description: { type: 'string', description: 'The question or review instruction.' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id', 'label'],
      },
    },
    allowOther: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          badge: { type: 'string' },
          defaultChecked: { type: 'boolean' },
          removable: { type: 'boolean' },
        },
        required: ['id', 'title'],
      },
    },
    minSelected: { type: 'integer', minimum: 0 },
    maxSelected: { type: 'integer', minimum: 0 },
    minItems: { type: 'integer', minimum: 0 },
    initialText: { type: 'string' },
    format: { type: 'string', enum: ['markdown', 'plain'] },
    placeholder: { type: 'string' },
    minLength: { type: 'integer', minimum: 0 },
    maxLength: { type: 'integer', minimum: 1 },
    defaultValue: { type: 'boolean' },
    min: { type: 'number' },
    max: { type: 'number' },
    step: { type: 'number', exclusiveMinimum: 0 },
    initialValue: { type: 'number' },
    minLabel: { type: 'string' },
    maxLabel: { type: 'string' },
  },
  required: ['type', 'id', 'label', 'description'],
};

export const REQUEST_FEEDBACK_TOOL_DESCRIPTION = `Draft a structured, fire-and-forget feedback request for one or more OTHER PEOPLE in the current workspace's organization. Use RequestFeedback when the user wants a named teammate or other org member to answer, including "ask Karl", role-split reviews, team polls, or "get some feedback" when the context means remote teammates.

Do not use AskUserQuestion or PromptForUserInput for a named teammate: those tools ask only the person at this session, block the agent while that local person answers, stay on this machine, and do not deliver through Messaging. Conversely, when an ambiguous instruction such as "get some feedback on these" means ask the person at this session, use AskUserQuestion or PromptForUserInput instead.

RequestFeedback resolves every recipient by name or email with findOrgMembers, checks every subject with getResourceSharingStatus, validates quorum and per-recipient assignments, and returns immediately with a draft for the author to review. It does not publish a subject, create a server request, send a message, wait for a recipient, or silently fall back to asking the local user. The author must approve the compose widget before anything leaves the machine. If a person is ambiguous or absent, surface that outcome and stop. After draftReady, end the turn; replies arrive later through Messaging and wake the session separately.`;

export function getRequestFeedbackToolSchemas() {
  return [
    {
      name: 'RequestFeedback',
      description: REQUEST_FEEDBACK_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          recipients: {
            type: 'array',
            minItems: 1,
            description:
              'People outside this local session to ask. key is a draft-local assignment handle; nameOrEmail is resolved against the organization directory and is never guessed when ambiguous.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Unique draft-local handle, such as designer or karl.' },
                nameOrEmail: { type: 'string', description: 'Organization member name or email to resolve.' },
              },
              required: ['key', 'nameOrEmail'],
            },
          },
          asks: {
            type: 'array',
            minItems: 1,
            description:
              'Typed questions. Supports singleSelect, multiSelect, reorder, editText, confirm, and rating.',
            items: STRUCTURED_ASK_SCHEMA,
          },
          assignments: {
            type: 'array',
            description:
              'Optional per-recipient split. Omit to assign every ask to every recipient. Each entry maps an askId to one recipients[].key.',
            items: {
              type: 'object',
              properties: {
                askId: { type: 'string' },
                recipientKey: { type: 'string' },
              },
              required: ['askId', 'recipientKey'],
            },
          },
          subjects: {
            type: 'array',
            description:
              'Optional resources being reviewed. Sharing is checked by the tool; never supply or infer a shared flag.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['document', 'tracker', 'file', 'session'] },
                sourceId: { type: 'string' },
                label: { type: 'string', description: 'Human-readable title shown in the compose widget.' },
                context: { type: 'string', description: 'Optional muted context line, such as a containing folder.' },
                projectId: { type: 'string' },
              },
              required: ['kind', 'sourceId'],
            },
          },
          visibility: {
            type: 'string',
            enum: ['hiddenUntilAnswered', 'open'],
            description: 'Defaults to hiddenUntilAnswered.',
          },
          quorum: {
            type: 'object',
            description:
              'Defaults to all recipients. The compose surface supports first (1) or all (recipient count). Unreachable counts are rejected before review.',
            properties: {
              requiredRecipientCount: { type: 'integer', minimum: 1 },
            },
            required: ['requiredRecipientCount'],
          },
          deadline: {
            type: 'number',
            description: 'Optional deadline as epoch milliseconds.',
          },
        },
        required: ['recipients', 'asks'],
      },
    },
  ];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`RequestFeedback requires ${label} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`RequestFeedback requires a non-empty ${label}.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`RequestFeedback requires ${label} to be a finite number.`);
  }
  return value;
}

function parseOption(value: unknown, label: string) {
  const option = asRecord(value, label);
  return {
    id: requiredString(option.id, `${label}.id`),
    label: requiredString(option.label, `${label}.label`),
    description: optionalString(option.description, `${label}.description`),
  };
}

function parseItem(value: unknown, label: string) {
  const item = asRecord(value, label);
  return {
    id: requiredString(item.id, `${label}.id`),
    title: requiredString(item.title, `${label}.title`),
    subtitle: optionalString(item.subtitle, `${label}.subtitle`),
    badge: optionalString(item.badge, `${label}.badge`),
    defaultChecked: typeof item.defaultChecked === 'boolean' ? item.defaultChecked : undefined,
    removable: typeof item.removable === 'boolean' ? item.removable : undefined,
  };
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`RequestFeedback requires ${label} to be a non-empty array.`);
  }
  return value;
}

function parseAsk(value: unknown, index: number): FeedbackAsk {
  const label = `asks[${index}]`;
  const ask = asRecord(value, label);
  const type = requiredString(ask.type, `${label}.type`);
  const base = {
    id: requiredString(ask.id, `${label}.id`),
    label: requiredString(ask.label, `${label}.label`),
    description: requiredString(ask.description, `${label}.description`),
  };

  switch (type) {
    case 'singleSelect':
      return {
        ...base,
        type,
        options: requireArray(ask.options, `${label}.options`).map((option, optionIndex) =>
          parseOption(option, `${label}.options[${optionIndex}]`),
        ),
        allowOther: typeof ask.allowOther === 'boolean' ? ask.allowOther : undefined,
      };
    case 'multiSelect':
      return {
        ...base,
        type,
        items: requireArray(ask.items, `${label}.items`).map((item, itemIndex) =>
          parseItem(item, `${label}.items[${itemIndex}]`),
        ),
        minSelected: optionalFiniteNumber(ask.minSelected, `${label}.minSelected`),
        maxSelected: optionalFiniteNumber(ask.maxSelected, `${label}.maxSelected`),
      };
    case 'reorder':
      return {
        ...base,
        type,
        items: requireArray(ask.items, `${label}.items`).map((item, itemIndex) =>
          parseItem(item, `${label}.items[${itemIndex}]`),
        ),
        minItems: optionalFiniteNumber(ask.minItems, `${label}.minItems`),
      };
    case 'editText': {
      if (typeof ask.initialText !== 'string') {
        throw new Error(`RequestFeedback requires ${label}.initialText to be a string.`);
      }
      if (ask.format !== undefined && ask.format !== 'markdown' && ask.format !== 'plain') {
        throw new Error(`RequestFeedback ${label}.format must be 'markdown' or 'plain'.`);
      }
      return {
        ...base,
        type,
        initialText: ask.initialText,
        format: ask.format,
        placeholder: optionalString(ask.placeholder, `${label}.placeholder`),
        minLength: optionalFiniteNumber(ask.minLength, `${label}.minLength`),
        maxLength: optionalFiniteNumber(ask.maxLength, `${label}.maxLength`),
      };
    }
    case 'confirm':
      return {
        ...base,
        type,
        defaultValue: typeof ask.defaultValue === 'boolean' ? ask.defaultValue : undefined,
      };
    case 'rating': {
      const min = optionalFiniteNumber(ask.min, `${label}.min`);
      const max = optionalFiniteNumber(ask.max, `${label}.max`);
      if (min === undefined || max === undefined || max <= min) {
        throw new Error(`RequestFeedback ${label} rating requires finite min and max with max greater than min.`);
      }
      return {
        ...base,
        type,
        min,
        max,
        step: optionalFiniteNumber(ask.step, `${label}.step`),
        initialValue: optionalFiniteNumber(ask.initialValue, `${label}.initialValue`),
        minLabel: optionalString(ask.minLabel, `${label}.minLabel`),
        maxLabel: optionalString(ask.maxLabel, `${label}.maxLabel`),
      };
    }
    default:
      throw new Error(
        `RequestFeedback ${label}.type must be singleSelect, multiSelect, reorder, editText, confirm, or rating.`,
      );
  }
}

function parseInput(args: unknown): RequestFeedbackInput {
  const input = asRecord(args, 'arguments');
  const recipientValues = requireArray(input.recipients, 'recipients');
  const recipients = recipientValues.map((value, index) => {
    const recipient = asRecord(value, `recipients[${index}]`);
    return {
      key: requiredString(recipient.key, `recipients[${index}].key`),
      nameOrEmail: requiredString(recipient.nameOrEmail, `recipients[${index}].nameOrEmail`),
    };
  });
  if (new Set(recipients.map((recipient) => recipient.key)).size !== recipients.length) {
    throw new Error('RequestFeedback recipient keys must be unique.');
  }

  const asks = requireArray(input.asks, 'asks').map(parseAsk);
  if (new Set(asks.map((ask) => ask.id)).size !== asks.length) {
    throw new Error('RequestFeedback ask ids must be unique.');
  }

  const assignments = input.assignments === undefined
    ? undefined
    : (Array.isArray(input.assignments) ? input.assignments : (() => {
        throw new Error('RequestFeedback assignments must be an array when provided.');
      })()).map((value, index) => {
        const assignment = asRecord(value, `assignments[${index}]`);
        return {
          askId: requiredString(assignment.askId, `assignments[${index}].askId`),
          recipientKey: requiredString(
            assignment.recipientKey,
            `assignments[${index}].recipientKey`,
          ),
        };
      });

  const subjects = input.subjects === undefined
    ? []
    : (Array.isArray(input.subjects) ? input.subjects : (() => {
        throw new Error('RequestFeedback subjects must be an array when provided.');
      })()).map((value, index) => {
        const subject = asRecord(value, `subjects[${index}]`);
        if (!['document', 'tracker', 'file', 'session'].includes(String(subject.kind))) {
          throw new Error(
            `RequestFeedback subjects[${index}].kind must be document, tracker, file, or session.`,
          );
        }
        return {
          kind: subject.kind as ResourceSharingKind,
          sourceId: requiredString(subject.sourceId, `subjects[${index}].sourceId`),
          label: optionalString(subject.label, `subjects[${index}].label`),
          context: optionalString(subject.context, `subjects[${index}].context`),
          projectId: optionalString(subject.projectId, `subjects[${index}].projectId`),
        };
      });

  if (input.visibility !== undefined
    && input.visibility !== 'hiddenUntilAnswered'
    && input.visibility !== 'open') {
    throw new Error("RequestFeedback visibility must be 'hiddenUntilAnswered' or 'open'.");
  }

  let requiredRecipientCount = recipients.length;
  if (input.quorum !== undefined) {
    const quorum = asRecord(input.quorum, 'quorum');
    if (!Number.isInteger(quorum.requiredRecipientCount)) {
      throw new Error('RequestFeedback quorum.requiredRecipientCount must be an integer.');
    }
    requiredRecipientCount = quorum.requiredRecipientCount as number;
  }

  return {
    recipients,
    asks,
    assignments,
    subjects,
    visibility: (input.visibility as FeedbackRequestVisibility | undefined) ?? 'hiddenUntilAnswered',
    quorum: { requiredRecipientCount },
    deadline: optionalFiniteNumber(input.deadline, 'deadline'),
  };
}

function outcome(value: RequestFeedbackOutcome, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

export async function draftRequestFeedback(
  args: unknown,
  workspacePath: string | undefined,
  dependencies: RequestFeedbackDependencies = requestFeedbackDependencies,
): Promise<RequestFeedbackOutcome> {
  if (!workspacePath?.trim()) {
    throw new Error('RequestFeedback requires an explicit workspacePath.');
  }
  const input = parseInput(args);
  const directoryResults = await Promise.all(
    input.recipients.map((recipient) =>
      dependencies.findOrgMembers(recipient.nameOrEmail, workspacePath),
    ),
  );

  for (let index = 0; index < directoryResults.length; index += 1) {
    const directory = directoryResults[index]!;
    const recipient = input.recipients[index]!;
    if (directory.status === 'noTeam') {
      return { status: 'noTeam', message: directory.message };
    }
    if (directory.status === 'ambiguous') {
      return {
        status: 'ambiguousRecipient',
        action: 'askWhichRecipient',
        message: directory.message,
        recipientKey: recipient.key,
        nameOrEmail: recipient.nameOrEmail,
        matches: directory.members,
      };
    }
    if (directory.status !== 'matched' || directory.members.length !== 1) {
      return {
        status: 'recipientNotFound',
        message: directory.message,
        recipientKey: recipient.key,
        nameOrEmail: recipient.nameOrEmail,
      };
    }
  }

  const org = directoryResults[0]!.org;
  if (!org || directoryResults.some((directory) => directory.org?.orgId !== org.orgId)) {
    return {
      status: 'invalidDraft',
      message: 'All recipients must resolve in the same current organization.',
      errors: [{ code: 'recipientOrgMismatch', message: 'Recipients resolved in different organizations.' }],
    };
  }

  const recipients: FeedbackRequestRecipient[] = directoryResults.map((directory) => ({
    userId: directory.members[0]!.memberId,
    name: directory.members[0]!.displayName,
  }));
  const userIdByRecipientKey = new Map(
    input.recipients.map((recipient, index) => [recipient.key, recipients[index]!.userId]),
  );
  const assignments: FeedbackAskAssignment[] = input.assignments === undefined
    ? recipients.flatMap((recipient) =>
        input.asks.map((ask) => ({
          askId: ask.id,
          target: { kind: 'user' as const, userId: recipient.userId },
        })),
      )
    : input.assignments.map((assignment) => {
        const userId = userIdByRecipientKey.get(assignment.recipientKey);
        if (!userId) {
          throw new Error(
            `RequestFeedback assignment recipientKey '${assignment.recipientKey}' does not name a recipient.`,
          );
        }
        return { askId: assignment.askId, target: { kind: 'user' as const, userId } };
      });

  const validation = validateFeedbackRequest({
    asks: input.asks,
    recipients,
    assignments,
    quorum: input.quorum,
  });
  if (!validation.valid) {
    return {
      status: 'invalidDraft',
      message: validation.errors.map((error) => error.message).join(' '),
      errors: validation.errors,
    };
  }

  if (input.quorum.requiredRecipientCount !== 1
    && input.quorum.requiredRecipientCount !== recipients.length) {
    return {
      status: 'invalidDraft',
      message: 'The compose surface currently supports quorum from the first reply or from all recipients.',
      errors: [{
        code: 'unsupportedQuorum',
        message: 'requiredRecipientCount must be 1 or the total recipient count.',
      }],
    };
  }

  const sharingStatuses = await Promise.all(
    input.subjects.map((subject) =>
      dependencies.getResourceSharingStatus(subject.kind, subject.sourceId, workspacePath),
    ),
  );
  for (let index = 0; index < sharingStatuses.length; index += 1) {
    const sharing = sharingStatuses[index]!;
    const subject = input.subjects[index]!;
    if (sharing.reason === 'notFound') {
      return {
        status: 'subjectNotFound',
        message: `${subject.kind} subject '${subject.sourceId}' was not found.`,
        subject,
      };
    }
    if (sharing.reason === 'noTeam') {
      return {
        status: 'noTeam',
        message: `The ${subject.kind} subject '${subject.sourceId}' has no current organization.`,
      };
    }
    if (sharing.orgId && sharing.orgId !== org.orgId) {
      return {
        status: 'invalidDraft',
        message: `Subject '${subject.sourceId}' is shared with a different organization.`,
        errors: [{
          code: 'subjectOrgMismatch',
          message: `Subject '${subject.sourceId}' belongs to ${sharing.orgId}, not ${org.orgId}.`,
        }],
      };
    }
  }

  return {
    status: 'draftReady',
    message:
      'Draft ready for author review. Nothing has been published or sent, and this call is not waiting for a recipient.',
    draft: {
      orgId: org.orgId,
      recipients,
      asks: input.asks,
      assignments,
      subjects: input.subjects.map((subject, index) => ({
        ref: {
          orgId: sharingStatuses[index]!.orgId ?? org.orgId,
          kind: subject.kind,
          sourceId: subject.sourceId,
          ...(subject.projectId ? { projectId: subject.projectId } : {}),
        },
        label: subject.label ?? subject.sourceId,
        ...(subject.context ? { context: subject.context } : {}),
        shared: sharingStatuses[index]!.teamVisible,
      })),
      visibility: input.visibility,
      quorum: input.quorum,
      quorumMode: input.quorum.requiredRecipientCount === 1 ? 'first' : 'all',
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
    },
  };
}

export async function handleRequestFeedback(
  args: unknown,
  workspacePath: string | undefined,
  dependencies: RequestFeedbackDependencies = requestFeedbackDependencies,
): Promise<McpToolResult> {
  const drafted = await draftRequestFeedback(args, workspacePath, dependencies);
  return outcome(drafted, drafted.status === 'invalidDraft' || drafted.status === 'subjectNotFound');
}
