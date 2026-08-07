const DEFAULT_REQUIRED_SECTIONS = [
  "Demarrage rapide",
  "Installation locale",
  "Lancement",
  "Utilisation"
];

export function validateGithubReadmeGuide(content, options = {}) {
  const text = String(content || "");
  const requiredSections = options.requiredSections?.length
    ? options.requiredSections
    : DEFAULT_REQUIRED_SECTIONS;
  const requiredCommands = [...new Set((options.requiredCommands || []).filter(Boolean))];
  const missingSections = requiredSections.filter((section) => !hasSection(text, section));
  const missingCommands = requiredCommands.filter((command) => !text.includes(command));
  const invalidContent = [];

  if (text.includes("[object Object]")) invalidContent.push("object-object");
  if (options.requireClone && !/\bgit clone https:\/\/github\.com\//i.test(text)) {
    invalidContent.push("clone-command-missing");
  }
  if (hasSection(text, "Utilisation") && sectionBody(text, "Utilisation").replace(/[`#*_\-\s]/g, "").length < 40) {
    invalidContent.push("usage-too-short");
  }

  const status = missingSections.length || missingCommands.length || invalidContent.length ? "FAIL" : "OK";
  return { status, missingSections, missingCommands, invalidContent };
}

function hasSection(content, section) {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "mi").test(content);
}

function sectionBody(content, section) {
  const match = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "mi").exec(content);
  if (!match) return "";
  const remainder = content.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^##\s+/m);
  return (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
