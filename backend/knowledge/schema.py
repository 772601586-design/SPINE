"""Document the existing envelope and give each routed operation a stable unique ID."""
import re
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.types import OpenApiTypes


class KnowledgeSchema(AutoSchema):
    def get_operation_id(self):
        route = self.path.split('/knowledge/', 1)[-1]
        return 'knowledge_' + re.sub(r'[^a-zA-Z0-9]+', '_', route).strip('_') + '_' + self.method.lower()

    def get_tags(self):
        return ['Knowledge editorial' if '/manage/' in self.path else 'Knowledge public']

    def get_request_serializer(self):
        if self.method in ['POST', 'PUT', 'PATCH']:
            if '/imports/' in self.path and '{' not in self.path:
                return {'multipart/form-data': {'type': 'object', 'required': ['file'], 'properties': {'file': {'type': 'string', 'format': 'binary'}}}}
            return OpenApiTypes.OBJECT
        return None

    def get_response_serializers(self):
        return {200: {'type': 'object', 'properties': {
            'data': {'description': 'Article, catalog, editorial object, or paginated result array. See ai_path/知识库实施与验收.md.'},
            'meta': {'type': 'object', 'properties': {'count': {'type': 'integer'}, 'page': {'type': 'integer'},
                                                    'next': {'type': 'integer', 'nullable': True}, 'suggestions': {'type': 'array', 'items': {'type': 'string'}}}},
        }}, 400: {'type': 'object', 'properties': {'error': {'type': 'object'}}},
            401: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT, 410: OpenApiTypes.OBJECT}
