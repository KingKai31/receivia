// Cron entry point: starts the workflow's `daily` task. Needs RENDER_API_KEY and WORKFLOW_SLUG
// (the workflow service slug, e.g. receivia-agent).
import { Render } from '@renderinc/sdk';

const slug = process.env.WORKFLOW_SLUG ?? 'receivia-agent';
const render = new Render(); // reads RENDER_API_KEY
const started = await render.workflows.startTask(`${slug}/daily`, []);
console.log('started', JSON.stringify(started));
