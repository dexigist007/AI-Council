# Prompt Registry

- `<id>/v<N>.md` — one file per version. Never edit a version that has been used in sessions;
  add `v<N+1>.md` instead. Sessions record `prompt_id` + `prompt_version`.
- `roles/<role-id>.md` — role briefs injected into council prompts as `{{role_brief}}`.
- Placeholders are `{{name}}`; a missing value is an error, not an empty string.
- Prompts are written in English; `{{output_language}}` controls the language of the prose the
  models produce.
