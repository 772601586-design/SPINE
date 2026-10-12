from django.contrib.auth import authenticate, get_user_model
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()


class LoginResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    user = UserSerializer()


class LoginThrottle(AnonRateThrottle):
    rate = "20/min"


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]

    @extend_schema(request=LoginSerializer, responses=LoginResponseSerializer, tags=["Personal account"])
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(**serializer.validated_data)
        if user is None:
            return Response({"detail": "用户名或密码错误。"}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=user.pk)
            token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutView(APIView):
    @extend_schema(request=None, responses={204: None}, tags=["Personal account"])
    def post(self, request):
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    @extend_schema(responses=UserSerializer, tags=["Personal account"])
    def get(self, request):
        return Response(UserSerializer(request.user).data)
