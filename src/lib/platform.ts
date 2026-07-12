export function isWindows() {
  if (typeof navigator === "undefined") return false;

  return /Windows/i.test(navigator.userAgent) || /^Win/i.test(navigator.platform);
}

export function supportsSkillDragAndDrop() {
  return !isWindows();
}
