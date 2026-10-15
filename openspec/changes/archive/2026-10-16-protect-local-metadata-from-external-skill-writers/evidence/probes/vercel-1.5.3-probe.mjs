import {readFile,writeFile,mkdir} from "node:fs/promises";import {join,dirname} from "node:path";import {homedir} from "node:os";const AGENTS_DIR=".agents",AGENTS_DIR$1=".agents",LOCK_FILE=".skill-lock.json",LOCK_FILE$1=".skill-lock.json",CURRENT_VERSION=3,CURRENT_VERSION$1=3;
function getSkillLockPath$1() {
	const xdgStateHome = process.env.XDG_STATE_HOME;
	if (xdgStateHome) return join(xdgStateHome, "skills", LOCK_FILE$1);
	return join(homedir(), AGENTS_DIR$1, LOCK_FILE$1);
}
async function readSkillLock$1() {
	const lockPath = getSkillLockPath$1();
	try {
		const content = await readFile(lockPath, "utf-8");
		const parsed = JSON.parse(content);
		if (typeof parsed.version !== "number" || !parsed.skills) return createEmptyLockFile();
		if (parsed.version < CURRENT_VERSION$1) return createEmptyLockFile();
		return parsed;
	} catch (error) {
		return createEmptyLockFile();
	}
}
async function writeSkillLock(lock) {
	const lockPath = getSkillLockPath$1();
	await mkdir(dirname(lockPath), { recursive: true });
	await writeFile(lockPath, JSON.stringify(lock, null, 2), "utf-8");
}
async function addSkillToLock(skillName, entry) {
	const lock = await readSkillLock$1();
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const existingEntry = lock.skills[skillName];
	lock.skills[skillName] = {
		...entry,
		installedAt: existingEntry?.installedAt ?? now,
		updatedAt: now
	};
	await writeSkillLock(lock);
}
function createEmptyLockFile() {
	return {
		version: CURRENT_VERSION$1,
		skills: {},
		dismissed: {}
	};
}
const old={source:"old/repo",sourceType:"github",sourceUrl:"url",skillFolderHash:"old-tree",commitSha:"private",ref:"dev",pinnedRef:"v1",installedAt:"before"};await writeSkillLock({version:3,topUnknown:{a:1},skills:{demo:old}});await addSkillToLock("other",{source:"new/repo",skillFolderHash:"new-tree"});let a=await readSkillLock$1();console.log("unrelated",JSON.stringify(a));if(a.skills.demo.commitSha!=="private"||a.skills.demo.pinnedRef!=="v1")throw Error("lost");await addSkillToLock("demo",{source:"foreign/repo",skillFolderHash:"foreign-tree"});let b=await readSkillLock$1();console.log("same-name",JSON.stringify(b.skills.demo));if(b.skills.demo.commitSha!==undefined||b.skills.demo.installedAt!=="before")throw Error("unexpected");