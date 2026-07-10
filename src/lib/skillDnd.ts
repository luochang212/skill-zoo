export const LOCAL_SKILL_DRAG_TYPE = "local-skill";
export const STAR_SKILL_DROP_ID = "star-skill";
export const SKILL_DRAG_ID_PREFIX = "skill:";
export const AGENT_SKILL_DROP_PREFIX = "agent:";

export function getAgentSkillDropId(agent: string) {
  return `${AGENT_SKILL_DROP_PREFIX}${agent}`;
}

export function getAgentFromSkillDropId(id: string) {
  return id.startsWith(AGENT_SKILL_DROP_PREFIX) ? id.slice(AGENT_SKILL_DROP_PREFIX.length) : null;
}
