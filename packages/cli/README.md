# Skill Zoo CLI

Agent-native command line control surface for Skill Zoo.

```bash
npm install -g skill-zoo
skill-zoo list
skill-zoo archive code-audit --yes
skill-zoo restore code-audit-a1b2c3d4 --yes
```

The CLI reads and writes the same local Skill Zoo state as the desktop app. It does not notify a running desktop app; refresh or restart the app to see CLI changes.
