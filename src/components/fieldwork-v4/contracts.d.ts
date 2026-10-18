/** Actual host contract. Mutation receipts must contain authoritative read-back state. */
export type {DraftInput,PlanDraft,Section as SectionKey} from '@/lib/ui/fieldwork-plan-drafts'
export type {FieldworkState as InitialViewState,ViewPreferences,SaveReceipt,FieldworkLocale as Lang} from '@/lib/ui/fieldwork-host'
export {mountFieldwork} from './app.js'
