import trCommon from './tr/common'
import enCommon from './en/common'
import trShell from './tr/shell'
import enShell from './en/shell'
import trCouncil from './tr/council'
import enCouncil from './en/council'
import trIdeas from './tr/ideas'
import enIdeas from './en/ideas'
import trProjects from './tr/projects'
import enProjects from './en/projects'

// One namespace per area of the app. Turkish is the reference shape; English must match it.
const tr = { common: trCommon, shell: trShell, council: trCouncil, ideas: trIdeas, projects: trProjects }
export type Messages = typeof tr
const en: Messages = { common: enCommon, shell: enShell, council: enCouncil, ideas: enIdeas, projects: enProjects }

export const messages: Record<'tr' | 'en', Messages> = { tr, en }
