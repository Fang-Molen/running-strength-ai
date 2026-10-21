import type { MuscleAction } from '@/lib/body/muscle-actions';
import type { ScheduleEntry } from './day-schedule-rules';
import { newTrainingDraft, type TrainingDraft } from './training-editor';

/** The store adds its template prefix; an ephemeral calendar-entry ID is not a course identity. */
export function trainingTemplateDraftKey(template?: Pick<ScheduleEntry, 'id' | 'modality' | 'refId'>): string | undefined {
  if (!template) return undefined;
  return template.refId ? `${template.modality}:${template.refId}` : template.id;
}

/** Existing user input wins over navigation hints. Explicit action entry may add a strength part. */
export function initializeTrainingDraft({ date, id, existing, initialType, seedAction, openMuscleInitially = false, createExerciseId }: {
  date: string;
  id: string;
  existing?: TrainingDraft | null;
  initialType?: TrainingDraft['type'];
  seedAction?: MuscleAction;
  openMuscleInitially?: boolean;
  createExerciseId: () => string;
}): TrainingDraft {
  let draft: TrainingDraft = { ...newTrainingDraft(date, id), ...(existing ? structuredClone(existing) : {}) };
  if (!existing && initialType) draft.type = initialType;
  if (seedAction || openMuscleInitially) {
    draft.type = draft.type === 'run' || draft.type === 'mixed' ? 'mixed' : 'strength';
  }
  if (seedAction && !draft.exercises.some(e =>
    Boolean(seedAction.catalogId && e.catalogId === seedAction.catalogId) ||
    Boolean(seedAction.id && e.sourceId === seedAction.id) || e.name === seedAction.name)) {
    draft = {
      ...draft,
      exercises: [...draft.exercises, {
        id: createExerciseId(), catalogId: seedAction.catalogId, sourceId: seedAction.id,
        sourceUrl: seedAction.sourceUrl ?? undefined, name: seedAction.name,
        sets: '', reps: '', weight: '', rpe: '', unit: seedAction.unit ?? undefined,
        restSec: seedAction.restSec ?? 75,
      }],
    };
  }
  return draft;
}
