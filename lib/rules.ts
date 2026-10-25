// Pure game rules. No I/O. Values come from the design doc (Requirements 2, 4).
export type AssignmentType = 'final_exam' | 'capstone' | 'test' | 'quiz' | 'homework';

export const TYPE_WEIGHT: Record<AssignmentType, number> = {
  final_exam: 100, capstone: 80, test: 60, quiz: 25, homework: 10,
};
export const SHIELD_TYPES: AssignmentType[] = ['final_exam', 'capstone', 'test'];

export function isType(t: unknown): t is AssignmentType {
  return typeof t === 'string' && t in TYPE_WEIGHT;
}

// score% x type weight x difficulty multiplier, rounded.
export function assignmentValue(pct: number, type: AssignmentType, multiplier: number): number {
  const p = Math.max(0, Math.min(100, pct));
  const m = Math.max(1, Math.min(1.5, multiplier));
  return Math.round((p / 100) * TYPE_WEIGHT[type] * m);
}

export function earnsShield(pct: number, type: AssignmentType): boolean {
  return pct >= 100 && SHIELD_TYPES.includes(type);
}
