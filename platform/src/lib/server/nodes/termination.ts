export const terminationOutcomes = [
  'terminated',
  'killed',
  'already_exited',
  'refused_identity',
  'refused_gpu',
  'error'
] as const;

export type TerminationOutcome = (typeof terminationOutcomes)[number];

export type TerminationResultReport = {
  instructionId: string;
  outcome: TerminationOutcome;
  detail: string;
  termSent: boolean;
  killSent: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTerminationResult(value: unknown): TerminationResultReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.instructionId !== 'string' ||
    !uuidPattern.test(body.instructionId) ||
    typeof body.outcome !== 'string' ||
    !terminationOutcomes.includes(body.outcome as TerminationOutcome) ||
    typeof body.detail !== 'string' ||
    body.detail.length < 1 ||
    body.detail.length > 1000 ||
    typeof body.termSent !== 'boolean' ||
    typeof body.killSent !== 'boolean'
  ) {
    return null;
  }
  if (body.killSent && !body.termSent) return null;
  return body as TerminationResultReport;
}
