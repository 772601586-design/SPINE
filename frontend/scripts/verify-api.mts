// Calls the same API client used by the React page. No mock or fallback response.
import { fetchHealth } from '../src/api.ts';

const baseUrl = process.env.SPINE_API_BASE_URL || 'http://127.0.0.1:8000';
const health = await fetchHealth(baseUrl);
console.log(JSON.stringify({ client: 'frontend', url: baseUrl, health }, null, 2));
