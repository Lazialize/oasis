export interface ProjectModeRefreshOptions {
  isActive: () => boolean;
  detect: () => Promise<boolean>;
  getConfigFiles: () => readonly string[];
  notifyConfigFilesAdded: (paths: readonly string[]) => Promise<void>;
  setActive: (active: boolean) => void;
  reconcileOpenDocuments: () => Promise<void>;
}

/** Recompute project mode after workspace topology changes. Newly discovered config paths are
 * forwarded before open-document reconciliation so nested projects are eagerly loaded even when
 * their existing files produce no watcher Created events. */
export async function refreshProjectMode(options: ProjectModeRefreshOptions): Promise<void> {
  const previousConfigFiles = new Set(options.getConfigFiles());
  const active = await options.detect();
  const addedConfigFiles = options.getConfigFiles().filter((path) => !previousConfigFiles.has(path));
  if (addedConfigFiles.length > 0) await options.notifyConfigFilesAdded(addedConfigFiles);
  if (active === options.isActive()) return;
  options.setActive(active);
  await options.reconcileOpenDocuments();
}
