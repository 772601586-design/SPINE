declare function knowledgePage(request: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: Record<string, unknown>) => Promise<unknown>): { data: unknown; [key: string]: unknown };
export = knowledgePage;
