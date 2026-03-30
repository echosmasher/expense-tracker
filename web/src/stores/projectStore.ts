import { create } from 'zustand'
import type { Project } from '@expense-tracker/shared'

interface ProjectState {
  projects: Array<{ id: string; name: string; status: string; memberCount: number }>
  activeProject: Project | null
  setProjects: (projects: ProjectState['projects']) => void
  setActiveProject: (project: Project | null) => void
  addProject: (project: Project) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProject: null,
  setProjects: (projects) => set({ projects }),
  setActiveProject: (activeProject) => set({ activeProject }),
  addProject: (project) =>
    set((state) => ({
      projects: [
        { id: project.id, name: project.name, status: project.status, memberCount: project.members.length },
        ...state.projects.filter((p) => p.id !== project.id),
      ],
      activeProject: project,
    })),
}))
