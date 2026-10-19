import {
  artifactName,
  kindLabels,
  type ArtifactSummary,
  type StrategySpec,
} from "@qmt/shared";

export type LibraryFilters = {
  query: string;
  kind: "all" | StrategySpec["kind"];
  status: "all" | "passed" | "failed";
};
export function filterScripts(
  items: ArtifactSummary[],
  filters: LibraryFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (filters.kind === "all" || item.spec.kind === filters.kind) &&
      (filters.status === "all" ||
        item.report.passed === (filters.status === "passed")) &&
      (!query ||
        `${artifactName(item)} ${item.spec.name} ${item.spec.symbol} ${kindLabels[item.spec.kind]}`
          .toLocaleLowerCase()
          .includes(query)),
  );
}
export function copyName(item: ArtifactSummary, items: ArtifactSummary[]) {
  const names = new Set(items.map(artifactName));
  const original = artifactName(item);
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? " · 副本" : ` · 副本 ${index}`;
    const name = original.slice(0, 60 - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}
