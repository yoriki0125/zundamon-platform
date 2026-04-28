const MAX_HUMAN_ID_LENGTH = 50;

export function normalizeHumanId(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_HUMAN_ID_LENGTH) {
    return undefined;
  }
  return normalized;
}

export function resolveWidgetUserId(
  humanId: string | null | undefined,
  fallbackUserId: string | null | undefined
): string | undefined {
  const normalizedHumanId = normalizeHumanId(humanId);
  if (normalizedHumanId) return normalizedHumanId;
  return normalizeHumanId(fallbackUserId);
}
