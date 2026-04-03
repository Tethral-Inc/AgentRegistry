import { Hono } from 'hono';
import { queryOne, makeError } from '@acr/shared';

const app = new Hono();

app.get('/skill-version/:name', async (c) => {
  const name = c.req.param('name');

  const row = await queryOne<{
    skill_name: string;
    current_version: string;
    download_url: string;
  }>(
    `SELECT skill_name AS "skill_name", current_version AS "current_version",
     download_url AS "download_url"
     FROM skill_versions WHERE skill_name = $1`,
    [name],
  );

  if (!row) {
    return c.json(makeError('SKILL_NOT_FOUND', `Skill ${name} not found`), 404);
  }

  return c.json({
    name: row.skill_name,
    current_version: row.current_version,
    download_url: row.download_url,
  });
});

export { app as skillVersionRoute };
