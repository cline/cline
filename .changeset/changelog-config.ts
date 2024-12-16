import { ChangelogFunctions } from '@changesets/types';

const getReleaseLine: ChangelogFunctions['getReleaseLine'] = async (changeset) => {
  const [firstLine] = changeset.summary
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  return `-   ${firstLine}`;
};

const getDependencyReleaseLine: ChangelogFunctions['getDependencyReleaseLine'] = async () => {
  return '';
};

const changelogFunctions: ChangelogFunctions = {
  getReleaseLine,
  getDependencyReleaseLine,
};

export default changelogFunctions;