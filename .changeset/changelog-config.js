// Doesn't fully work but '.github/scripts/overwrite_changeset_changelog.py' forces the changelog to be formatted in GHA

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