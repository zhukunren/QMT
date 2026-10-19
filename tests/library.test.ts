import { describe, expect, it } from "vitest";
import {
  artifactFilename,
  artifactName,
  defaultSpec,
  type ArtifactSummary,
} from "@qmt/shared";
import { copyName, filterScripts } from "../apps/web/src/library";

function item(
  id: string,
  kind: ArtifactSummary["spec"]["kind"],
  passed: boolean,
  displayName?: string,
): ArtifactSummary {
  return {
    id,
    createdAt: "2026-10-19T10:00:00Z",
    provider: "template",
    prompt: "",
    spec: { ...defaultSpec, kind, name: `原始策略 ${id}` },
    displayName,
    summary: "",
    assumptions: [],
    sources: [],
    report: {
      passed,
      checks: [],
      pythonVersion: "3.12",
      codeHash: "hash",
      scope: "",
    },
  };
}
const items = [
  item("1", "ma_cross", true, "浦发双均线"),
  item("2", "momentum", false, "动量观察"),
  item("3", "momentum", true, "动量研究"),
  item("4", "mean_reversion", true, "均价偏离"),
];
describe("script library selection and reuse", () => {
  it("combines type, validation state and case-insensitive text filters", () => {
    expect(
      filterScripts(items, {
        query: "  600000.sh  ",
        kind: "momentum",
        status: "passed",
      }).map((i) => i.id),
    ).toEqual(["3"]);
    expect(
      filterScripts(items, {
        query: "动量",
        kind: "all",
        status: "failed",
      }).map((i) => i.id),
    ).toEqual(["2"]);
    expect(
      filterScripts(items, { query: "浦发", kind: "all", status: "all" }).map(
        (i) => i.id,
      ),
    ).toEqual(["1"]);
    expect(
      filterScripts(items, {
        query: "",
        kind: "mean_reversion",
        status: "failed",
      }),
    ).toEqual([]);
  });
  it("still finds legacy records and original names after a rename", () => {
    expect(artifactName(item("legacy", "ma_cross", true))).toBe(
      "原始策略 legacy",
    );
    expect(
      filterScripts(items, { query: "原始策略 1", kind: "all", status: "all" }),
    ).toEqual([items[0]]);
  });
  it("creates distinct draft names within the name limit", () => {
    const source = items[0];
    expect(copyName(source, items)).toBe("浦发双均线 · 副本");
    expect(
      copyName(source, [
        ...items,
        { ...source, id: "copy", displayName: "浦发双均线 · 副本" },
      ]),
    ).toBe("浦发双均线 · 副本 2");
    expect(
      copyName({ ...source, displayName: "测".repeat(60) }, items),
    ).toHaveLength(60);
  });
  it("uses the display name in safe, identifiable download filenames", () => {
    const source = {
      ...items[0],
      id: "12345678-abcd",
      displayName: "研究/策略:观察*?",
    };
    expect(artifactFilename(source)).toBe("qmt_研究_策略_观察___12345678.py");
    expect(artifactFilename(source, true)).toMatch(/_12345678_report\.pdf$/);
    expect(artifactFilename(source)).not.toMatch(/[<>:"/\\|?*]/);
  });
});
