const getReleaseLine = async (changeset) => {
  const [firstLine] = changeset.summary
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  return `- ${firstLine}`;
};

const getDependencyReleaseLine = async () => {
  return '';
};

const getReleaseSummary = async (release) => {
  return `## [${release.newVersion}]\n\n`;
};

const changelogFunctions = {
  getReleaseLine,
  getDependencyReleaseLine,
  getReleaseSummary,
};

module.exports = changelogFunctions;