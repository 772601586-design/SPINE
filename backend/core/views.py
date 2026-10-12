from django.db import DatabaseError, connection
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok"])
    service = serializers.CharField()
    api_version = serializers.CharField()
    timestamp = serializers.DateTimeField()


class ReadySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok", "unavailable"])
    database = serializers.ChoiceField(choices=["ok", "unavailable"])


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses=HealthSerializer, summary="Backend liveness (does not check the database)", tags=["Infrastructure"])
    def get(self, request):
        return Response({
            "status": "ok", "service": "spine-backend", "api_version": "v1",
            "timestamp": timezone.now().isoformat(),
        })


class ReadyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={200: ReadySerializer, 503: ReadySerializer}, summary="PostgreSQL readiness (SELECT 1)", tags=["Infrastructure"])
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                result = cursor.fetchone()
            if result != (1,):
                raise DatabaseError("Unexpected readiness result")
        except DatabaseError:
            # Never return connection details or credentials to clients.
            return Response({"status": "unavailable", "database": "unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"status": "ok", "database": "ok"})
