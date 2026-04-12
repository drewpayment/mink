export interface RegisteredProject {
  id: string;
  cwd: string;
  name: string;
  version: string;
}

export interface ProjectsResponse {
  projects: RegisteredProject[];
  activeProjectId: string;
}
