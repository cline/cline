const getReleaseLine = async (changeset) => {
  const [firstLine] = changeset.summary
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  return `-   ${firstLine}`;
};

const getDependencyReleaseLine = async () => {
  return '';
};

const changelogFunctions = {
  getReleaseLine,
  getDependencyReleaseLine,
};

module.exports = changelogFunctions;