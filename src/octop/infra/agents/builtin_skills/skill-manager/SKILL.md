---
name: skill-manager
description: Must be used to manage the current expert instance's Skills through conversation, including finding, inspecting, installing, importing, updating, editing, listing, restoring, or deleting them. Supports SkillHub skill page URLs, the SkillHub CLI, local and uploaded files, SKILL.md, ZIP/TAR, Git/GitHub, and ordinary download URLs; it is also used to turn any material — PDFs, Markdown, documents, code, images — into a new Skill.
metadata:
  octop:
    emoji: "🧩"
    label:
      en: "Skill Manager"
    summary:
      en: "Find, install, import, update, or delete skills on this instance."
---

# Skill Manager

You only manage the current instance's `{{OCTOP_SKILLS}}/`. The current instance workspace is fixed at `{{OCTOP_WORKSPACE}}`; uploaded files usually live in its `inbound/`. System files (skills, built-in skills, sessions, and so on) live in the directory containing `{{OCTOP_SKILLS}}`. Do not re-guess the workspace with `pwd`, `$HOME`, `~/.octop-harness/workspace`, memory files, or search results. Do not modify other instances, the global skill directory, or `{{OCTOP_BUILTIN_SKILLS}}/`.

## Entry point

Use the built-in script for inspecting, downloading, safe extraction, installing, listing, and removing:

```bash
python "{{OCTOP_BUILTIN_SKILLS}}/skill-manager/scripts/manage_skills.py" <command>
```

```bash
# List installed skills
... list

# Inspect a source without writing to the installed skills directory
... inspect "<file-directory-url-or-skillhub:slug>"

# Install; multiple Skills in a repository or archive can be installed at once
... install "<source>" [--subpath "path/in/repo"] [--name "slug"]

# Overwrite only after the user has explicitly agreed to a replacement
... install "<source>" --force

# SkillHub search; results can be inspected or installed with skillhub:<slug>
... skillhub-search "<query>" --limit 10

# Run only after the user has explicitly agreed to deletion; moves the Skill to skills/.trash/
... remove "<slug>" --yes

# Restore from the trash
... restore "<trash-name>"
```

## Handling sources

1. **Ready-made Skill, directory, or ZIP/TAR**: run `inspect` first; run `install` once it passes and the user has asked to install.
2. **Git/GitHub URL**: repositories, GitHub `tree` subdirectories, and `blob` URLs pointing at a `SKILL.md` can all be handled directly. For complex repositories use `git+<url>` with `--subpath`.
3. **SkillHub page URL**: a SkillHub skill page URL ending in `/skills/<namespace>/<slug>` can be passed straight to `inspect` or `install`; the script parses the namespace and slug. Do not install or upgrade the CLI yourself, and do not run `skillhub install` directly.
4. **Plain HTTP(S) URL**: the script handles direct files and archives. If the URL points at some other landing page, read it with the existing web tools first, find the public repository, download address, or `SKILL.md`, and hand that to the script. Never bypass logins, paywalls, or access controls.
5. **SkillHub search**: when the user only describes a capability, search first and offer 1–3 candidates with their slug, name, purpose, and source so the user can choose; when the user names a specific Skill, inspect and install it directly.
6. **Any non-Skill file**: ordinary material does not become a Skill just by copying it. Read and understand the material first, then use the built-in `skill-creator` workflow to organize the reusable knowledge, steps, and necessary resources into a valid Skill, write it to `{{OCTOP_SKILLS}}/<slug>/`, and run `inspect` to validate it.

## Change rules

- A new install request is itself consent to add; if the target already exists, stop and explain the conflict, and only use `--force` with explicit consent.
- Before editing an existing Skill, read its `SKILL.md` and related resources, change only that Skill's directory, and re-run `inspect` afterwards.
- Before deleting, name the target and get explicit confirmation. Use `remove --yes`; do not `rm -rf` directly. Use `restore` when something needs to be recovered.
- After installing, report the slug and the final path. A newly installed, updated, or deleted Skill usually takes full effect starting from the next new session.

## Safety boundaries

- The script limits download and extraction size and file count, rejects path traversal and symlinks, and installs through a staging directory.
- Do not execute, import, or source code from downloaded packages. Installing deploys Skill content; it does not mean third-party code has passed a security audit.
- Do not echo URL credentials in output; for private sources use only the Git or SkillHub credentials already present in the environment.
- If the current instance has no shell execution capability, you can still handle simple text Skills with file tools, but you must say that URL downloads, safe extraction, and the SkillHub CLI cannot be done — never pretend they succeeded.
