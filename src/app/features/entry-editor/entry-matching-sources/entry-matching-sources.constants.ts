import type { EntryExtensionKey } from '../../../core/models/lorebook.model';

/** Extension keys of the per-entry "additional matching sources" flags. */
export type MatchSourceKey = Extract<
  EntryExtensionKey,
  | 'match_character_description'
  | 'match_character_personality'
  | 'match_scenario'
  | 'match_persona_description'
  | 'match_character_depth_prompt'
  | 'match_creator_notes'
>;

/** One checkbox of the "additional matching sources" chip row. */
export interface MatchSourceOption {
  key: MatchSourceKey;
  label: string;
  hint: string;
}

/** Per-entry "additional matching sources" chips, ordered like the ST docs. */
export const MATCH_SOURCE_OPTIONS: readonly MatchSourceOption[] = [
  {
    key: 'match_character_description',
    label: 'Character Description',
    hint: 'Also match keys against the character description',
  },
  {
    key: 'match_character_personality',
    label: 'Character Personality',
    hint: 'Also match keys against the character personality summary',
  },
  {
    key: 'match_scenario',
    label: 'Scenario',
    hint: 'Also match keys against the character scenario',
  },
  {
    key: 'match_persona_description',
    label: 'Persona Description',
    hint: 'Also match keys against the active persona description',
  },
  {
    key: 'match_character_depth_prompt',
    label: "Character's Note",
    hint: 'Also match keys against the character note',
  },
  {
    key: 'match_creator_notes',
    label: "Creator's Notes",
    hint: 'Also match keys against the character creator notes',
  },
];
