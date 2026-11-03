import createKnowledgePage from '../../knowledge/page';
import { request } from '../../services/request';
Page(createKnowledgePage((method, path, data) => request(method, path, data, { preservePagination: true })));
