// Half-works to simplify the format but needs 'overwrite_changeset_changelog.py' in GHA to finish formatting

const getReleaseLine = async (changeset) => {
	const [firstLine] = changeset.summary
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
	return `- ${firstLine}`
}

const getDependencyReleaseLine = async () => {
	return ""
}

const changelogFunctions = {
	getReleaseLine,
	getDependencyReleaseLine,
}

module.exports = changelogFunctions
