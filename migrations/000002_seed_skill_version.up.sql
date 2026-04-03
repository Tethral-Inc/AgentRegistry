INSERT INTO skill_versions (skill_name, current_version, download_url)
VALUES ('acr-agent-registry', '0.1.0', 'https://clawhub.ai/skills/acr-agent-registry')
ON CONFLICT (skill_name) DO UPDATE SET
  current_version = EXCLUDED.current_version,
  download_url = EXCLUDED.download_url,
  updated_at = now();
