-- Migration: Add manifest_inputs column to installed_skills
-- Stores the SkillManifest.inputs[] definition as JSON so it survives
-- skill directory deletion / corruption.
ALTER TABLE installed_skills ADD COLUMN manifest_inputs TEXT;
