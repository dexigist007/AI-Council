export const BRAIN_SECTIONS = ['purpose', 'summary', 'architecture', 'modules', 'external_apis', 'data_storage', 'open_questions'] as const
export type BrainSection = (typeof BRAIN_SECTIONS)[number] | 'stack'

export const SECTION_LABEL: Record<BrainSection, string> = {
  purpose: 'Amaç',
  summary: 'Özet',
  architecture: 'Mimari',
  modules: 'Önemli modüller',
  external_apis: 'Dış servisler ve API\'ler',
  data_storage: 'Veri saklama',
  open_questions: 'Açık sorular',
  stack: 'Teknoloji yığını',
}
