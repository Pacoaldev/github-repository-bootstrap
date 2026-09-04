import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  preflightTemplateDestinations,
  projectLinkResponseMatches,
} from "../scripts/bootstrap.mjs";
import {
  LIMITS,
  authorizationValue,
  buildPlan,
  createProjectV2ViewArgs,
  emptyReport,
  mapProjectV2ViewLayout,
  normalizeConfig,
  normalizeGitHubOrigin,
  parseOAuthScopes,
  repositoryBindingMatches,
  resolveProjectByTitle,
  resolveProjectViewByName,
  validationErrors,
  writeTemplateFile,
} from "../scripts/lib.mjs";

const configuration = {
  account: "egdev6",
  repository: "egdev6/particle-studio",
  labels: {
    "type:bug": { color: "D73A4A" },
    "priority:high": { color: "B60205", description: "Urgent", managed: true },
  },
  milestones: { Foundation: {} },
  templates: {
    issueForms: ["bug_report"],
    issueFormLabels: { bug_report: ["type:bug"] },
    pullRequest: true,
    mode: "ensure",
  },
  project: {
    title: "Particle Studio",
    fields: {
      Priority: { dataType: "SINGLE_SELECT", options: ["High", "Low"] },
    },
    views: { Board: { layout: "BOARD" } },
  },
};

const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function errorsFor(config) {
  return validationErrors(config).map((error) => error.path);
}

function messagesFor(config) {
  return validationErrors(config).map((error) => error.message);
}

test("validation rejects unsafe or incomplete project fields", () => {
  const invalid = structuredClone(configuration);
  invalid.project.fields.Priority = { dataType: "SINGLE_SELECT" };
  invalid.labels["type:bug"].color = "#bad";
  const errors = errorsFor(invalid);
  assert.equal(errors.includes("$.project.fields.Priority.options"), true);
  assert.equal(errors.includes("$.labels.type:bug.color"), true);
});

test("runtime validation enforces schema limits and canonical map identities", () => {
  const invalid = structuredClone(configuration);
  invalid.labels = Object.fromEntries(
    Array.from({ length: LIMITS.labels + 1 }, (_, index) => [
      `label-${index}`,
      { color: "D73A4A" },
    ]),
  );
  invalid.project.fields.Priority.options = ["High, urgent", "High, urgent"];
  const errors = errorsFor(invalid);
  assert.equal(errors.includes("$.labels"), true);
  assert.equal(errors.includes("$.project.fields.Priority.options[0]"), true);
  assert.equal(errors.includes("$.project.fields.Priority.options[1]"), true);

  const schema = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "config.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.properties.labels.type, undefined);
  assert.equal(schema.$defs.labels.type, "object");
  assert.equal(schema.$defs.labels.maxProperties, LIMITS.labels);
  assert.equal(schema.$defs.field.properties.options.maxItems, LIMITS.options);
  assert.equal(schema.$defs.field.properties.options.uniqueItems, true);
  assert.equal(schema.$defs.field.properties.options.items.pattern, "^[^,]+$");
});

test("existing project fields skip only when their configuration matches", () => {
  const config = normalizeConfig(configuration);
  const matching = {
    name: "Priority",
    type: "ProjectV2SingleSelectField",
    options: [{ name: "High" }, { name: "Low" }],
  };
  const plan = buildPlan(config, { fields: [matching] });
  assert.equal(
    plan.find(
      (entry) =>
        entry.resource === "project-field" && entry.target === "Priority",
    ).action,
    "skip",
  );
  assert.throws(
    () => buildPlan(config, { fields: [{ ...matching, dataType: "TEXT" }] }),
    /differs from managed configuration/,
  );
  assert.throws(
    () =>
      buildPlan(config, {
        fields: [{ ...matching, options: [{ name: "Low" }, { name: "High" }] }],
      }),
    /differs from managed configuration/,
  );
});

test("template preflight rejects symlink destinations before remote mutations", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".template-preflight-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    const outside = path.join(temporaryDirectory, "outside");
    fs.mkdirSync(path.join(repository, ".github"), { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(
      outside,
      path.join(repository, ".github", "ISSUE_TEMPLATE"),
    );
    let remoteMutationCalled = false;
    assert.throws(
      () =>
        preflightTemplateDestinations(configuration, repository, () => {
          remoteMutationCalled = true;
        }),
      /symbolic link/,
    );
    assert.equal(remoteMutationCalled, false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("template destinations reject symbolic links and permit regular in-repository files", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".template-destination-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    const outside = path.join(temporaryDirectory, "outside");
    fs.mkdirSync(repository);
    fs.mkdirSync(outside);
    fs.symlinkSync(
      path.join(outside, "config.yml"),
      path.join(repository, "destination-link"),
    );
    assert.throws(
      () => writeTemplateFile(repository, "destination-link", "unsafe"),
      /symbolic link/,
    );

    fs.symlinkSync(outside, path.join(repository, "linked-parent"));
    assert.throws(
      () => writeTemplateFile(repository, "linked-parent/config.yml", "unsafe"),
      /symbolic link/,
    );

    writeTemplateFile(repository, ".github/ISSUE_TEMPLATE/config.yml", "safe");
    assert.equal(
      fs.readFileSync(
        path.join(repository, ".github/ISSUE_TEMPLATE/config.yml"),
        "utf8",
      ),
      "safe",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("legacy resource arrays fail clearly instead of silently accepting duplicate identities", () => {
  const invalid = structuredClone(configuration);
  invalid.labels = [
    { name: "type:bug", color: "D73A4A" },
    { name: "type:bug", color: "FFFFFF" },
  ];
  assert.equal(errorsFor(invalid).includes("$.labels"), true);
  assert.equal(
    messagesFor(invalid).includes(
      "legacy arrays are unsupported; use an object map keyed by the managed identity",
    ),
    true,
  );
});

test("normalization sorts resource maps before plan generation", () => {
  const reversed = structuredClone(configuration);
  reversed.labels = {
    "priority:high": configuration.labels["priority:high"],
    "type:bug": configuration.labels["type:bug"],
  };
  reversed.milestones = { Zebra: {}, Foundation: {} };
  reversed.project.fields = {
    "Target date": { dataType: "DATE" },
    Priority: configuration.project.fields.Priority,
  };
  reversed.project.views = {
    Table: { layout: "TABLE" },
    Board: { layout: "BOARD" },
  };
  const normalized = normalizeConfig(reversed);
  assert.deepEqual(
    normalized.labels.map((label) => label.name),
    ["priority:high", "type:bug"],
  );
  assert.deepEqual(
    normalized.milestones.map((milestone) => milestone.title),
    ["Foundation", "Zebra"],
  );
  assert.deepEqual(
    normalized.project.fields.map((field) => field.name),
    ["Priority", "Target date"],
  );
  assert.deepEqual(
    normalized.project.views.map((view) => view.name),
    ["Board", "Table"],
  );
});

test("plan creates missing resources and preserves unmanaged existing resources", () => {
  const config = normalizeConfig(configuration);
  const plan = buildPlan(config, {
    labels: [
      { name: "type:bug", color: "FFFFFF", description: "Different" },
      { name: "priority:high", color: "FFFFFF", description: "Different" },
    ],
    milestones: [{ title: "Foundation", description: null, dueOn: null }],
    templates: [".github/ISSUE_TEMPLATE/bug_report.yml"],
    project: {
      id: "PVT_kwDOExample",
      title: "Particle Studio",
      number: 1,
      linked: false,
    },
    fields: [],
    views: [],
    viewsSupported: true,
  });
  assert.deepEqual(
    plan.find(
      (entry) => entry.resource === "label" && entry.target === "type:bug",
    ).action,
    "skip",
  );
  assert.deepEqual(
    plan.find(
      (entry) => entry.resource === "label" && entry.target === "priority:high",
    ).action,
    "update",
  );
  assert.deepEqual(
    plan.find((entry) => entry.resource === "project-link").action,
    "link",
  );
  assert.deepEqual(
    plan.find((entry) => entry.resource === "project-field").action,
    "create",
  );
  assert.deepEqual(
    plan.find((entry) => entry.resource === "project-view").action,
    "create",
  );
  assert.equal(
    plan.some((entry) => entry.target === ".github/ISSUE_TEMPLATE/config.yml"),
    true,
  );
});

test("plan reports unavailable GraphQL views without emulation", () => {
  const plan = buildPlan(normalizeConfig(configuration), {
    viewsSupported: false,
  });
  const view = plan.find((entry) => entry.resource === "project-view");
  assert.equal(view.action, "unsupported");
  assert.match(view.reason, /GraphQL/);
});

test("GitHub Projects v2 layouts map to GraphQL layout enums", () => {
  assert.equal(mapProjectV2ViewLayout("BOARD"), "BOARD_LAYOUT");
  assert.equal(mapProjectV2ViewLayout("TABLE"), "TABLE_LAYOUT");
  assert.throws(
    () => mapProjectV2ViewLayout("ROADMAP"),
    /Unsupported configured/,
  );
});

test("duplicate configured project view names fail closed", () => {
  assert.throws(
    () =>
      resolveProjectViewByName(
        [
          { id: "PVTV_1", name: "Board" },
          { id: "PVTV_2", name: "Board" },
        ],
        "Board",
      ),
    /Duplicate GitHub Projects v2 view name/,
  );
  assert.throws(
    () =>
      buildPlan(normalizeConfig(configuration), {
        viewsSupported: true,
        views: [
          { id: "PVTV_1", name: "Board" },
          { id: "PVTV_2", name: "Board" },
        ],
      }),
    /Duplicate GitHub Projects v2 view name/,
  );
});

test("project view plan preserves unmanaged default views", () => {
  const plan = buildPlan(normalizeConfig(configuration), {
    viewsSupported: true,
    views: [{ id: "PVTV_default", name: "View 1", layout: "TABLE_LAYOUT" }],
  });
  const configuredBoard = plan.find(
    (entry) => entry.resource === "project-view" && entry.target === "Board",
  );
  assert.equal(configuredBoard.action, "create");
  assert.equal(
    plan.some(
      (entry) => entry.resource === "project-view" && entry.target === "View 1",
    ),
    false,
  );
  assert.equal(
    plan.some(
      (entry) => entry.action === "update" || entry.action === "delete",
    ),
    false,
  );
});

test("createProjectV2View GraphQL arguments bind the exact input", () => {
  const args = createProjectV2ViewArgs("PVT_kwDOExample", {
    name: "Board",
    layout: "BOARD",
    settings: { visibleFieldIds: ["PVTF_priority", "PVTF_target_date"] },
  });
  assert.deepEqual(args.slice(0, 3), ["api", "graphql", "-f"]);
  assert.match(args[3], /createProjectV2View/);
  assert.deepEqual(args.slice(4), [
    "-F",
    "input[projectId]=PVT_kwDOExample",
    "-F",
    "input[name]=Board",
    "-F",
    "input[layout]=BOARD_LAYOUT",
    "-F",
    "input[configuration][visibleFieldIds][]=PVTF_priority",
    "-F",
    "input[configuration][visibleFieldIds][]=PVTF_target_date",
  ]);
});

test("repository binding accepts only exact supported GitHub HTTPS and SSH origins", () => {
  for (const origin of [
    "https://github.com/egdev6/particle-studio.git",
    "https://github.com/egdev6/particle-studio/",
    "git@github.com:egdev6/particle-studio.git",
    "ssh://git@github.com/egdev6/particle-studio.git",
  ]) {
    assert.equal(
      repositoryBindingMatches("EgDev6/Particle-Studio", origin),
      true,
    );
  }
  for (const origin of [
    "https://token@github.com/egdev6/particle-studio.git",
    "https://@github.com/egdev6/particle-studio.git",
    "https://github.com/egdev6/particle-studio.git?ref=main",
    "https://github.com/egdev6/particle-studio.git#readme",
    "https://gitlab.com/egdev6/particle-studio.git",
    "https://github.com/egdev6/particle-studio/extra",
    "https://github.com/egdev6/",
    "https://github.com//particle-studio",
    "https://github.com/egdev6/particle-studio.git.backup",
    "ssh://user@github.com/egdev6/particle-studio.git",
    "git@github.com:egdev6/particle-studio.git/extra",
  ]) {
    assert.equal(normalizeGitHubOrigin(origin), null, origin);
  }
  assert.equal(
    repositoryBindingMatches(
      "egdev6/particle-studio",
      "git@github.com:egdev6/other.git",
    ),
    false,
  );
});

test("duplicate project titles fail closed before identity selection", () => {
  assert.throws(
    () =>
      resolveProjectByTitle(
        [
          { id: "PVT_1", number: 1, title: "Particle Studio" },
          { id: "PVT_2", number: 2, title: "Particle Studio" },
        ],
        "Particle Studio",
      ),
    /Duplicate GitHub Projects v2 title/,
  );
  assert.deepEqual(
    resolveProjectByTitle(
      [{ id: "PVT_1", number: 1, title: "Particle Studio" }],
      "Particle Studio",
    ),
    { id: "PVT_1", number: 1, title: "Particle Studio" },
  );
});

test("authorization hash binds the exact canonical plan inputs", () => {
  const inputs = {
    config: normalizeConfig(configuration),
    target: {
      repoDir: "/work/particle-studio",
      origin: "git@github.com:egdev6/particle-studio.git",
      repository: configuration.repository,
    },
    observed: {
      labels: [],
      milestones: [],
      templates: [],
      project: null,
      fields: [],
      views: [],
      viewsSupported: null,
      repositoryId: "R_1",
    },
    plan: [
      {
        resource: "label",
        target: "type:bug",
        action: "create",
        reason: "missing",
      },
    ],
  };
  const authorization = authorizationValue(inputs);
  assert.match(authorization, /^APPLY_GITHUB_PROJECT_BOOTSTRAP:[a-f0-9]{64}$/);
  assert.equal(authorizationValue(structuredClone(inputs)), authorization);
  const reordered = structuredClone(configuration);
  reordered.labels = {
    "priority:high": configuration.labels["priority:high"],
    "type:bug": configuration.labels["type:bug"],
  };
  assert.equal(
    authorizationValue({ ...inputs, config: normalizeConfig(reordered) }),
    authorization,
  );
  const changed = structuredClone(inputs);
  changed.observed.repositoryId = "R_2";
  assert.notEqual(authorizationValue(changed), authorization);
});

test("failure reports always retain the declared machine-readable shape", () => {
  const report = emptyReport("apply");
  report.failures.push({ message: "repository binding failed" });
  assert.deepEqual(Object.keys(report).sort(), [
    "authorization",
    "completed",
    "discovered",
    "failures",
    "mode",
    "plan",
    "schemaVersion",
    "skipped",
    "success",
    "validation",
  ]);
  assert.equal(report.success, false);
  assert.equal(
    Array.isArray(report.completed) &&
      Array.isArray(report.skipped) &&
      Array.isArray(report.failures),
    true,
  );
  assert.deepEqual(Object.keys(report.discovered).sort(), [
    "labels",
    "milestones",
    "project",
    "viewsSupported",
  ]);
});

test("templates enforce review labels, required scoped evidence, and no blank issues", () => {
  const readTemplate = (name) =>
    fs.readFileSync(path.join(skillRoot, "assets", "templates", name), "utf8");
  assert.match(readTemplate("config.yml"), /^blank_issues_enabled: false$/m);
  const bug = readTemplate("bug_report.yml");
  assert.match(bug, /id: environment/);
  assert.match(bug, /id: affected_area/);
  assert.match(bug, /id: agent_client/);
  assert.match(bug, /id: shell/);
  assert.match(bug, /report enters review before implementation/);
  assert.doesNotMatch(bug, /id: agent_client[\s\S]*?validations:/);
  assert.doesNotMatch(bug, /id: shell[\s\S]*?validations:/);
  const feature = readTemplate("feature_request.yml");
  assert.match(feature, /id: affected_area/);
  assert.match(feature, /id: scope_non_goals/);
  assert.match(feature, /proposal requires product review/);
  const example = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "example.config.json"),
      "utf8",
    ),
  );
  assert.equal(Object.hasOwn(example.labels, "status:needs-review"), true);
  assert.equal(example.labels["status:needs-review"].managed, true);
  assert.equal(
    example.templates.issueFormLabels.bug_report.includes(
      "status:needs-review",
    ),
    true,
  );
  assert.equal(
    example.templates.issueFormLabels.feature_request.includes(
      "status:needs-review",
    ),
    true,
  );
});

test("project link mutation requires the exact configured repository node ID", () => {
  const linked = {
    data: { linkProjectV2ToRepository: { repository: { id: "R_1" } } },
  };
  assert.equal(projectLinkResponseMatches(linked, "R_1"), true);
  assert.equal(projectLinkResponseMatches(linked, "R_2"), false);
  assert.equal(
    projectLinkResponseMatches(
      { data: { linkProjectV2ToRepository: {} } },
      "R_1",
    ),
    false,
  );
});

test("scope headers are deterministic", () => {
  assert.deepEqual(
    parseOAuthScopes(
      "HTTP/2 200\r\nx-oauth-scopes: repo, project, workflow\r\n",
    ),
    ["repo", "project", "workflow"],
  );
});
